import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { serviceDb } from "@/lib/server/supabase"
import { requireAdmin, AdminError, isAdmin } from "@/lib/server/admin"
import { classifyQuestions, INTENTS } from "@/lib/server/classify"
import { identify } from "@/lib/server/identity"
import { REPORTS } from "@/lib/registry"

// Admin intelligence over the assistant's question log.
// Body: { environment, token, action }
//   whoami    → { admin }                       (any signed-in user)
//   overview  → { questions, savedReports, insight, intents }   (admins; classifies new rows first)
//   insights  { windowDays? } → { insight }     (admins; asks Claude for direction and stores it)

export const maxDuration = 120

const INSIGHTS_MODEL = process.env.REPORT_LABS_INSIGHTS_MODEL || process.env.REPORT_LABS_MODEL || "claude-sonnet-5"
const MAX_ROWS = 2000

export interface LogQuestion {
  id: string
  created_at: string
  user_id: string
  user_login: string | null
  question: string
  report_id: string | null
  date_range: string | null
  mcp_enabled: boolean
  tools: string[]
  answer_chars: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  duration_ms: number | null
  error: string | null
  intent: string | null
  topics: string[] | null
  wants_dashboard: boolean | null
  matched_report: string | null
}

export interface SavedReportSummary {
  id: string
  user_login: string | null
  title: string
  source: string
  pinned: boolean
  view: string
  visibility: string
  updated_at: string
}

export interface Insight {
  id: string
  generated_by: string | null
  window_days: number | null
  markdown: string
  created_at: string
}

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

  if (action === "whoami") {
    try {
      const who = await identify(environment ?? "", token ?? "")
      return NextResponse.json({ admin: isAdmin(who), login: who.login })
    } catch {
      return NextResponse.json({ admin: false })
    }
  }

  let who
  try {
    who = await requireAdmin(environment, token)
  } catch (e) {
    const err = e instanceof AdminError ? e : new AdminError("Forbidden", 403)
    return NextResponse.json({ error: err.status === 401 ? "unauthorized" : "forbidden", message: err.message }, { status: err.status })
  }
  const env = who.environment

  try {
    if (action === "overview") {
      await classifyPending(db, env)
      const [{ data: rows, error: e1 }, { data: saved, error: e2 }, { data: ins, error: e3 }] = await Promise.all([
        db.from("assistant_log").select("id, created_at, user_id, user_login, question, report_id, date_range, mcp_enabled, tools, answer_chars, input_tokens, output_tokens, cache_read_tokens, duration_ms, error, intent, topics, wants_dashboard, matched_report").eq("environment", env).order("created_at", { ascending: false }).limit(MAX_ROWS),
        db.from("saved_reports").select("id, user_login, title, source, pinned, view, visibility, updated_at").eq("environment", env).order("updated_at", { ascending: false }).limit(200),
        db.from("admin_insights").select("id, generated_by, window_days, markdown, created_at").eq("environment", env).order("created_at", { ascending: false }).limit(1),
      ])
      if (e1) throw e1
      if (e2) throw e2
      if (e3) throw e3
      return NextResponse.json({
        environment: env,
        questions: (rows ?? []) as LogQuestion[],
        savedReports: (saved ?? []) as SavedReportSummary[],
        insight: ((ins ?? [])[0] as Insight | undefined) ?? null,
        intents: INTENTS,
        reports: REPORTS.map((r) => ({ id: r.id, title: r.title, group: r.group })),
      })
    }

    if (action === "insights") {
      const windowDays = Math.max(1, Math.min(365, Number(body.windowDays ?? 90) || 90))
      await classifyPending(db, env)
      const since = new Date(Date.now() - windowDays * 86400000).toISOString()
      const { data: rows, error } = await db.from("assistant_log").select("id, created_at, user_login, question, report_id, tools, duration_ms, error, intent, topics, wants_dashboard, matched_report, mcp_enabled").eq("environment", env).gte("created_at", since).order("created_at", { ascending: true }).limit(MAX_ROWS)
      if (error) throw error
      const { data: saved } = await db.from("saved_reports").select("title, source, user_login").eq("environment", env).limit(200)
      const insight = await generateInsight(env, windowDays, (rows ?? []) as LogQuestion[], (saved ?? []) as Pick<SavedReportSummary, "title" | "source" | "user_login">[])
      const { data, error: e2 } = await db.from("admin_insights").insert({ environment: env, generated_by: who.login || who.userId, window_days: windowDays, stats: insight.stats, markdown: insight.markdown }).select("id, generated_by, window_days, markdown, created_at").single()
      if (e2) throw e2
      return NextResponse.json({ insight: data as Insight })
    }

    return NextResponse.json({ error: "bad_request", message: `Unknown action ${action}` }, { status: 400 })
  } catch (e) {
    console.error("[admin]", e)
    return NextResponse.json({ error: "server_error", message: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// Classifies rows that have no intent yet, giving each one the same user's
// preceding question (within 20 minutes) as context for follow-ups.
async function classifyPending(db: NonNullable<ReturnType<typeof serviceDb>>, env: string) {
  const { data: pending } = await db.from("assistant_log").select("id, created_at, user_id, question, report_id").eq("environment", env).is("classified_at", null).order("created_at", { ascending: true }).limit(120)
  if (!pending?.length) return
  const ids = pending.map((p) => p.id as string)
  const users = Array.from(new Set(pending.map((p) => p.user_id as string)))
  const earliest = pending[0].created_at as string
  const { data: context } = await db.from("assistant_log").select("id, created_at, user_id, question").eq("environment", env).in("user_id", users as never[]).lte("created_at", earliest as never).order("created_at", { ascending: false }).limit(200)
  const all = [...(context ?? []), ...pending].filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const previousOf = (row: { id: string; created_at: string; user_id: string }) => {
    const t = new Date(row.created_at).getTime()
    for (let i = all.length - 1; i >= 0; i--) {
      const r = all[i]
      if (r.id === row.id || r.user_id !== row.user_id) continue
      const rt = new Date(String(r.created_at)).getTime()
      if (rt < t && t - rt < 20 * 60_000) return String(r.question)
      if (rt < t) break
    }
    return null
  }
  try {
    const results = await classifyQuestions(pending.map((p) => ({ id: p.id as string, question: p.question as string, previous: previousOf(p as { id: string; created_at: string; user_id: string }), report_id: p.report_id as string | null })))
    const now = new Date().toISOString()
    await Promise.all(results.map((r) => db.from("assistant_log").update({ intent: r.intent, topics: r.topics, wants_dashboard: r.wants_dashboard, matched_report: r.matched_report, classified_at: now }).eq("id", r.id)))
  } catch (e) {
    console.error("[admin] classify failed for", ids.length, "rows:", e instanceof Error ? e.message : e)
  }
}

async function generateInsight(env: string, windowDays: number, rows: LogQuestion[], saved: Pick<SavedReportSummary, "title" | "source" | "user_login">[]) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const anthropic = new Anthropic({ apiKey })

  const byIntent = new Map<string, { count: number; users: Set<string>; dashboards: number; matched: Map<string, number>; samples: string[] }>()
  for (const r of rows) {
    const k = r.intent ?? "unclassified"
    const b = byIntent.get(k) ?? { count: 0, users: new Set<string>(), dashboards: 0, matched: new Map<string, number>(), samples: [] as string[] }
    b.count++
    b.users.add(r.user_login ?? r.user_id)
    if (r.wants_dashboard) b.dashboards++
    b.matched.set(r.matched_report ?? "none", (b.matched.get(r.matched_report ?? "none") ?? 0) + 1)
    if (b.samples.length < 5 && !b.samples.includes(r.question)) b.samples.push(r.question.slice(0, 200))
    byIntent.set(k, b)
  }
  const stats = {
    windowDays,
    questions: rows.length,
    users: new Set(rows.map((r) => r.user_login ?? r.user_id)).size,
    errors: rows.filter((r) => r.error).length,
    dashboardsProposed: rows.filter((r) => (r.tools ?? []).includes("propose_report")).length,
    dashboardsSaved: saved.filter((s) => s.source === "assistant").length,
    medianSeconds: median(rows.map((r) => (r.duration_ms ?? 0) / 1000).filter((n) => n > 0)),
    mcpShare: rows.length ? rows.filter((r) => r.mcp_enabled).length / rows.length : 0,
    intents: Array.from(byIntent.entries()).map(([intent, b]) => ({ intent, description: INTENTS[intent], questions: b.count, users: b.users.size, dashboardsWanted: b.dashboards, coveredBy: Object.fromEntries(b.matched), samples: b.samples })).sort((a, b) => b.questions - a.questions),
  }
  const questionList = dedupe(rows.map((r) => ({ q: r.question.slice(0, 240), user: r.user_login ?? "?", intent: r.intent ?? "?", report: r.matched_report ?? "-", day: r.created_at.slice(0, 10) })))

  const system = `You are the product analyst for Aprimo Report Labs, a reporting tool for Aprimo DAM with standard reports and a question-answering assistant. You are given the log of questions people asked the assistant over the last ${windowDays} days, already classified by theme, plus the list of standard reports that exist today. Your job is to tell the product owner what people actually want and what to build next.

Write in plain, direct prose for a product owner. Be specific and evidence-led: cite counts and quote representative questions. Do not pad; if the data is thin, say so and still give your best read. Never invent questions or numbers that are not in the data.

Return GitHub-flavoured markdown with exactly these sections:
## What people are asking
A short read of the themes, with counts and who is asking (logins are fine, they are internal).
## Recommended base reports
A ranked list, 3 to 6 items. For each: a name, one sentence on what it shows, the evidence (how many questions and people asked for it), whether an existing standard report partly covers it, and a one-line sketch of the queries (Analytics cubes: Views, Downloads, Impressions, PreviewPlaybacks, ContentEngagement, ZeroViewRecords, ZeroDownloadRecords, Users, RecordMetadata, Records, Classifications, Spaces; Core API search expressions for library counts).
## Gaps in the current reports
Themes people ask about that no standard report answers, and standard reports nobody asks about.
## Assistant friction
Errors, slow turns, repeated questions, follow-ups that suggest the first answer missed. Use the durations and error fields.
## Suggested starter prompts
5 prompts to put in the assistant's empty state, drawn from what people actually ask, phrased so they run well.`

  const user = [
    `Environment: ${env}. Standard reports today:`,
    ...REPORTS.map((r) => `- ${r.id}: ${r.title} (${r.group}). ${r.description}`),
    "",
    `Saved dashboards (${saved.length}): ${saved.map((s) => `"${s.title}" [${s.source}, ${s.user_login ?? "?"}]`).join("; ") || "none"}`,
    "",
    "Aggregates:",
    JSON.stringify(stats, null, 1),
    "",
    `Distinct questions (${questionList.length}), with how many times each was asked:`,
    ...questionList.map((q) => `- (${q.times}x; ${q.users.join(", ")}; ${q.intent}; covered by ${q.report}; ${q.days.join(", ")}) ${q.q}`),
    "",
    "Slowest and failed turns:",
    ...rows
      .filter((r) => r.error || (r.duration_ms ?? 0) > 45_000)
      .slice(0, 20)
      .map((r) => `- ${r.created_at.slice(0, 16)} ${r.user_login ?? "?"}: ${Math.round((r.duration_ms ?? 0) / 1000)}s, tools ${(r.tools ?? []).length}${r.error ? `, error: ${r.error.slice(0, 120)}` : ""}: ${r.question.slice(0, 120)}`),
  ].join("\n")

  const res = await anthropic.messages.create({ model: INSIGHTS_MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: user }] })
  const markdown = res.content.filter((c) => c.type === "text").map((c) => (c.type === "text" ? c.text : "")).join("\n").trim()
  return { markdown, stats }
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function dedupe(items: Array<{ q: string; user: string; intent: string; report: string; day: string }>) {
  const map = new Map<string, { q: string; times: number; users: string[]; intent: string; report: string; days: string[] }>()
  for (const it of items) {
    const key = it.q.toLowerCase().replace(/\s+/g, " ").trim()
    const cur = map.get(key) ?? { q: it.q, times: 0, users: [], intent: it.intent, report: it.report, days: [] }
    cur.times++
    if (!cur.users.includes(it.user)) cur.users.push(it.user)
    if (!cur.days.includes(it.day)) cur.days.push(it.day)
    map.set(key, cur)
  }
  return Array.from(map.values()).sort((a, b) => b.times - a.times)
}
