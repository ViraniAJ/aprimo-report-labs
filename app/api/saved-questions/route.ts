import { NextRequest, NextResponse } from "next/server"
import { serviceDb, type SavedQuestionRow } from "@/lib/server/supabase"
import { identify, IdentityError } from "@/lib/server/identity"

// Saved questions, scoped to the signed-in Aprimo user and environment.
// Body: { environment, token, action, ...fields }
//   list                       → { items }
//   save   { question, title?, reportId?, dateRange? } → { item }
//   touch  { id }              → { item }   (bumps use_count / last_used_at)
//   pin    { id, pinned }      → { item }
//   delete { id }              → { ok }
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
        .from("saved_questions")
        .select("*")
        .match(scope)
        .order("pinned", { ascending: false })
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(100)
      if (error) throw error
      return NextResponse.json({ items: (data ?? []) as SavedQuestionRow[] })
    }

    if (action === "save") {
      const question = String(body.question ?? "").trim().slice(0, 2000)
      if (!question) return NextResponse.json({ error: "bad_request", message: "Question is empty" }, { status: 400 })
      // One row per distinct question per user: re-saving bumps it instead of duplicating.
      const { data: existing } = await db.from("saved_questions").select("*").match({ ...scope, question }).limit(1)
      if (existing && existing.length) {
        const row = existing[0] as SavedQuestionRow
        const { data, error } = await db
          .from("saved_questions")
          .update({ last_used_at: new Date().toISOString(), report_id: (body.reportId as string) ?? row.report_id, date_range: (body.dateRange as string) ?? row.date_range })
          .eq("id", row.id)
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ item: data, existed: true })
      }
      const { data, error } = await db
        .from("saved_questions")
        .insert({
          ...scope,
          user_login: who.login || null,
          question,
          title: body.title ? String(body.title).slice(0, 120) : null,
          report_id: body.reportId ? String(body.reportId) : null,
          date_range: body.dateRange ? String(body.dateRange) : null,
        })
        .select()
        .single()
      if (error) throw error
      return NextResponse.json({ item: data })
    }

    const id = String(body.id ?? "")
    if (!id) return NextResponse.json({ error: "bad_request", message: "Missing id" }, { status: 400 })

    if (action === "touch") {
      const { data: row } = await db.from("saved_questions").select("use_count").match({ ...scope, id }).single()
      const { data, error } = await db
        .from("saved_questions")
        .update({ use_count: ((row?.use_count as number | undefined) ?? 0) + 1, last_used_at: new Date().toISOString() })
        .match({ ...scope, id })
        .select()
        .single()
      if (error) throw error
      return NextResponse.json({ item: data })
    }
    if (action === "pin") {
      const { data, error } = await db.from("saved_questions").update({ pinned: !!body.pinned }).match({ ...scope, id }).select().single()
      if (error) throw error
      return NextResponse.json({ item: data })
    }
    if (action === "delete") {
      const { error } = await db.from("saved_questions").delete().match({ ...scope, id })
      if (error) throw error
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: "bad_request", message: `Unknown action ${action}` }, { status: 400 })
  } catch (e) {
    console.error("[saved-questions]", e)
    return NextResponse.json({ error: "server_error", message: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
