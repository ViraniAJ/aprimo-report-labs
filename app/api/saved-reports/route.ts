import { NextRequest, NextResponse } from "next/server"
import { serviceDb } from "@/lib/server/supabase"
import { identify, IdentityError } from "@/lib/server/identity"

// Saved reports, scoped to the signed-in Aprimo user and environment.
// Body: { environment, token, action, ...fields }
//   list                → { items }   (no html; light rows for the sidebar)
//   get    { id }       → { item }    (full, including html)
//   save   { id?, title, description?, view, spec, html?, source? } → { item }
//   pin    { id, pinned } → { item }
//   delete { id }       → { ok }

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

  try {
    if (action === "list") {
      const { data, error } = await db
        .from("saved_reports")
        .select("id, title, description, view, source, pinned, created_at, updated_at")
        .match(scope)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(200)
      if (error) throw error
      return NextResponse.json({ items: data ?? [] })
    }
    if (action === "get") {
      const { data, error } = await db.from("saved_reports").select("*").match({ ...scope, id: String(body.id ?? "") }).single()
      if (error) throw error
      return NextResponse.json({ item: data })
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
        const { data, error } = await db.from("saved_reports").update(row).match({ ...scope, id: String(body.id) }).select("id, title, description, view, source, pinned, created_at, updated_at").single()
        if (error) throw error
        return NextResponse.json({ item: data })
      }
      const { data, error } = await db.from("saved_reports").insert(row).select("id, title, description, view, source, pinned, created_at, updated_at").single()
      if (error) throw error
      return NextResponse.json({ item: data })
    }
    const id = String(body.id ?? "")
    if (!id) return NextResponse.json({ error: "bad_request", message: "Missing id" }, { status: 400 })
    if (action === "pin") {
      const { data, error } = await db.from("saved_reports").update({ pinned: !!body.pinned }).match({ ...scope, id }).select("id, title, description, view, source, pinned, created_at, updated_at").single()
      if (error) throw error
      return NextResponse.json({ item: data })
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
