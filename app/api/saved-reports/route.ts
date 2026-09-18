import { NextRequest, NextResponse } from "next/server"
import { serviceDb } from "@/lib/server/supabase"
import { identify, IdentityError } from "@/lib/server/identity"

// Saved reports, scoped to the signed-in Aprimo user and environment. A report
// shared with the environment is readable by every user of it; the owner is
// the only one who can change it.
// Body: { environment, token, action, ...fields }
//   list                → { items }   (own + shared; no html; `owner` flag)
//   get    { id }       → { item }    (full, including html; own or shared)
//   save   { id?, title, description?, view, spec, html?, source? } → { item }   (update: owner only)
//   share  { id, visibility: 'private' | 'environment' } → { item }              (owner only)
//   pin    { id, pinned } → { item }                                             (owner only)
//   delete { id }       → { ok }                                                 (owner only)

const MAX_HTML = 600_000
const MAX_SPEC = 60_000

export async function POST(req: NextRequest) {
  const db = serviceDb()
  if (!db) return NextResponse.json({ error: "not_configured", message: "Supabase is not configured on the server." }, { status: 503 })
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON" }, { status: 400 })
  }
  const { environment, token, action } = body as { environment?: string; token?: string; action?: string }
  if (!environment || !token || !action) return NextResponse.json({ error: "bad_request", message: "Missing environment, token, or action" }, { status: 400 })
  let who
  try {
    who = await identify(environment, token)
  } catch (e) {
    return NextResponse.json({ error: "unauthorized", message: e instanceof IdentityError ? e.message : "Could not verify token" }, { status: 401 })
  }
  const scope = { environment: who.environment, user_id: who.userId }
  const SUMMARY = "id, user_id, user_login, title, description, view, source, pinned, visibility, created_at, updated_at"
  // Rows the caller may read: their own, or any shared with the environment.
  const readable = `user_id.eq.${who.userId},visibility.eq.environment`
  const withOwner = <T extends { user_id?: string }>(row: T) => {
    const { user_id, ...rest } = row
    return { ...rest, owner: user_id === who.userId }
  }

  try {
    if (action === "list") {
      const { data, error } = await db
        .from("saved_reports")
        .select(SUMMARY)
        .eq("environment", who.environment)
        .or(readable)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(300)
      if (error) throw error
      return NextResponse.json({ items: (data ?? []).map(withOwner) })
    }
    if (action === "get") {
      const { data, error } = await db.from("saved_reports").select("*").eq("environment", who.environment).eq("id", String(body.id ?? "")).or(readable).single()
      if (error) throw error
      return NextResponse.json({ item: withOwner(data) })
    }
    if (action === "save") {
      const title = String(body.title ?? "").trim().slice(0, 160)
      const view = body.view === "standard" ? "standard" : "html"
      const spec = body.spec
      const html = body.html == null ? null : String(body.html)
      if (!title) return NextResponse.json({ error: "bad_request", message: "Title is required" }, { status: 400 })
      if (!spec || typeof spec !== "object") return NextResponse.json({ error: "bad_request", message: "Spec is required" }, { status: 400 })
      if (JSON.stringify(spec).length > MAX_SPEC) return NextResponse.json({ error: "bad_request", message: "Spec too large" }, { status: 400 })
      if (view === "html" && (!html || html.length > MAX_HTML)) return NextResponse.json({ error: "bad_request", message: `HTML view is required and must be under ${MAX_HTML} characters` }, { status: 400 })
      const row = {
        ...scope,
        user_login: who.login || null,
        title,
        description: body.description ? String(body.description).slice(0, 1000) : null,
        view,
        spec,
        html,
        source: body.source ? String(body.source).slice(0, 40) : "assistant",
        updated_at: new Date().toISOString(),
      }
      if (body.id) {
        const { data: existing } = await db.from("saved_reports").select("user_id").eq("environment", who.environment).eq("id", String(body.id)).maybeSingle()
        if (!existing) return NextResponse.json({ error: "not_found", message: "That saved report no longer exists" }, { status: 404 })
        if (existing.user_id !== who.userId) return NextResponse.json({ error: "forbidden", message: "Only the owner can update a shared report. Use Save as new to keep your own copy." }, { status: 403 })
        const { data, error } = await db.from("saved_reports").update(row).match({ ...scope, id: String(body.id) }).select(SUMMARY).single()
        if (error) throw error
        return NextResponse.json({ item: withOwner(data) })
      }
      const { data, error } = await db.from("saved_reports").insert(row).select(SUMMARY).single()
      if (error) throw error
      return NextResponse.json({ item: withOwner(data) })
    }
    const id = String(body.id ?? "")
    if (!id) return NextResponse.json({ error: "bad_request", message: "Missing id" }, { status: 400 })
    if (action === "share") {
      const visibility = body.visibility === "environment" ? "environment" : "private"
      const { data, error } = await db.from("saved_reports").update({ visibility }).match({ ...scope, id }).select(SUMMARY).maybeSingle()
      if (error) throw error
      if (!data) return NextResponse.json({ error: "forbidden", message: "Only the owner can share or unshare a report" }, { status: 403 })
      return NextResponse.json({ item: withOwner(data) })
    }
    if (action === "pin") {
      const { data, error } = await db.from("saved_reports").update({ pinned: !!body.pinned }).match({ ...scope, id }).select(SUMMARY).maybeSingle()
      if (error) throw error
      if (!data) return NextResponse.json({ error: "forbidden", message: "Only the owner can pin a report" }, { status: 403 })
      return NextResponse.json({ item: withOwner(data) })
    }
    if (action === "delete") {
      const { error } = await db.from("saved_reports").delete().match({ ...scope, id })
      if (error) throw error
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: "bad_request", message: `Unknown action ${action}` }, { status: 400 })
  } catch (e) {
    console.error("[saved-reports]", e)
    return NextResponse.json({ error: "server_error", message: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
