"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { MessageSquare, Users, LayoutDashboard, Save, Timer, TriangleAlert, Sparkles, RefreshCw, LogIn } from "lucide-react"
import { useAprimo } from "@/context/aprimo-context"
import { TopBar } from "@/components/topbar"
import { Button } from "@/components/ui/button"
import { KpiTile, ReportCard, DataTable, LoadingBlock, ErrorNote, EmptyNote } from "@/components/report-labs/ui"
import { RankedBars, ColumnChart } from "@/components/report-labs/charts"
import { Markdown } from "@/components/report-labs/markdown"
import { adminApi, AdminForbidden, type AdminOverview, type LogQuestion } from "@/lib/admin-api"
import { formatInt } from "@/lib/analytics"

// Admin intelligence: what people ask the assistant, grouped into themes,
// mapped onto the standard reports, with Claude's read on what to build next.

type Window = 7 | 30 | 90 | 0
const WINDOWS: Array<{ key: Window; label: string }> = [
  { key: 7, label: "7 days" },
  { key: 30, label: "30 days" },
  { key: 90, label: "90 days" },
  { key: 0, label: "All time" },
]

interface ThemeRow extends Record<string, unknown> {
  intent: string
  description: string
  questions: number
  people: number
  dashboards: number
  coveredBy: string
  gap: boolean
  sample: string
}
interface CoverageRow extends Record<string, unknown> {
  report: string
  group: string
  questions: number
  people: number
}
interface PersonRow extends Record<string, unknown> {
  login: string
  questions: number
  dashboards: number
  first: string
  last: string
  errors: number
}
interface QuestionRow extends Record<string, unknown> {
  id: string
  at: string
  login: string
  question: string
  intent: string
  context: string
  covered: string
  outcome: string
  seconds: number
  toolCount: number
}

function outcomeOf(q: LogQuestion): string {
  if (q.error) return "error"
  if ((q.tools ?? []).includes("propose_report")) return "dashboard"
  return "answered"
}

export default function AdminPage() {
  const { connection, isConnected } = useAprimo()
  const [data, setData] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState<string | null>(null)
  const [win, setWin] = useState<Window>(90)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const env = connection?.environment ?? ""
  const token = connection?.accessToken ?? ""

  useEffect(() => {
    if (!isConnected || !env || !token) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setForbidden(null)
    adminApi
      .overview(env, token)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof AdminForbidden) setForbidden(e.message)
        else setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isConnected, env, token])

  const rows = useMemo(() => {
    if (!data) return []
    if (!win) return data.questions
    const since = Date.now() - win * 86400000
    return data.questions.filter((q) => new Date(q.created_at).getTime() >= since)
  }, [data, win])

  const reportTitle = (id: string | null | undefined) => data?.reports.find((r) => r.id === id)?.title ?? null

  const stats = useMemo(() => {
    const people = new Set(rows.map((r) => r.user_login ?? r.user_id)).size
    const durations = rows.map((r) => r.duration_ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b)
    const median = durations.length ? durations[Math.floor(durations.length / 2)] / 1000 : null
    const savedByAssistant = data?.savedReports.filter((s) => s.source === "assistant").length ?? 0
    return {
      questions: rows.length,
      people,
      proposed: rows.filter((r) => outcomeOf(r) === "dashboard").length,
      saved: savedByAssistant,
      median,
      errors: rows.filter((r) => r.error).length,
      tokens: rows.reduce((a, r) => a + (r.input_tokens ?? 0) + (r.cache_read_tokens ?? 0) + (r.output_tokens ?? 0), 0),
      unclassified: rows.filter((r) => !r.intent).length,
    }
  }, [rows, data])

  const themes = useMemo<ThemeRow[]>(() => {
    if (!data) return []
    const m = new Map<string, { count: number; people: Set<string>; dashboards: number; matched: Map<string, number>; sample: string }>()
    for (const r of rows) {
      const k = r.intent ?? "unclassified"
      const b = m.get(k) ?? { count: 0, people: new Set(), dashboards: 0, matched: new Map(), sample: r.question }
      b.count++
      b.people.add(r.user_login ?? r.user_id)
      if (r.wants_dashboard) b.dashboards++
      const mk = r.matched_report ?? ""
      b.matched.set(mk, (b.matched.get(mk) ?? 0) + 1)
      if (r.question.length > b.sample.length && k !== "follow-up") b.sample = r.question
      m.set(k, b)
    }
    return Array.from(m.entries())
      .map(([intent, b]) => {
        const top = Array.from(b.matched.entries()).sort((a, c) => c[1] - a[1])[0]
        const covered = top && top[0] ? reportTitle(top[0]) : null
        return {
          intent,
          description: data.intents[intent] ?? "Not yet classified",
          questions: b.count,
          people: b.people.size,
          dashboards: b.dashboards,
          coveredBy: covered ?? (intent === "follow-up" ? "" : "No standard report"),
          gap: !covered && intent !== "follow-up" && intent !== "unclassified",
          sample: b.sample,
        }
      })
      .sort((a, b) => b.questions - a.questions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, data])

  const coverage = useMemo<CoverageRow[]>(() => {
    if (!data) return []
    return data.reports
      .filter((r) => r.group !== "Reference")
      .map((r) => {
        const hits = rows.filter((q) => q.matched_report === r.id)
        return { report: r.title, group: r.group, questions: hits.length, people: new Set(hits.map((h) => h.user_login ?? h.user_id)).size }
      })
      .sort((a, b) => b.questions - a.questions)
  }, [rows, data])

  const byDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const d = r.created_at.slice(0, 10)
      m.set(d, (m.get(d) ?? 0) + 1)
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, v]) => ({ label: new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }), value: v }))
  }, [rows])

  const people = useMemo<PersonRow[]>(() => {
    const m = new Map<string, PersonRow>()
    for (const r of rows) {
      const login = r.user_login ?? r.user_id
      const p = m.get(login) ?? { login, questions: 0, dashboards: 0, first: r.created_at, last: r.created_at, errors: 0 }
      p.questions++
      if (outcomeOf(r) === "dashboard") p.dashboards++
      if (r.error) p.errors++
      if (r.created_at < p.first) p.first = r.created_at
      if (r.created_at > p.last) p.last = r.created_at
      m.set(login, p)
    }
    return Array.from(m.values()).sort((a, b) => b.questions - a.questions)
  }, [rows])

  const topics = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) for (const t of r.topics ?? []) m.set(t, (m.get(t) ?? 0) + 1)
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([label, value]) => ({ label, value }))
  }, [rows])

  const tools = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) for (const t of r.tools ?? []) m.set(t, (m.get(t) ?? 0) + 1)
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([label, value]) => ({ label, value }))
  }, [rows])

  const questionRows = useMemo<QuestionRow[]>(
    () =>
      rows.map((r) => ({
        id: r.id,
        at: r.created_at,
        login: r.user_login ?? r.user_id.slice(0, 8),
        question: r.question,
        intent: r.intent ?? "",
        context: reportTitle(r.report_id) ?? "Landing",
        covered: reportTitle(r.matched_report) ?? "",
        outcome: outcomeOf(r),
        seconds: Math.round((r.duration_ms ?? 0) / 1000),
        toolCount: (r.tools ?? []).length,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, data],
  )

  async function regenerate() {
    if (!env || !token) return
    setGenerating(true)
    setGenError(null)
    try {
      const insight = await adminApi.insights(env, token, win || 365)
      setData((d) => (d ? { ...d, insight } : d))
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TopBar />
      <main className="flex-1 px-5 sm:px-8 py-8">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Admin</p>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">What people ask the assistant</h1>
              <p className="text-sm text-muted-foreground max-w-2xl">Every question typed into Ask a question, grouped by theme and mapped onto the standard reports, so the next base reports come from real demand.{data ? ` Environment ${data.environment}.` : ""}</p>
            </div>
            <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
              {WINDOWS.map((w) => (
                <button key={w.key} onClick={() => setWin(w.key)} className={`px-3 py-1.5 transition-colors ${win === w.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                  {w.label}
                </button>
              ))}
            </div>
          </header>

          {!isConnected && (
            <ReportCard title="Connect to view">
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">Sign in with your Aprimo login. Only logins on the deployment&apos;s admin list can open this page.</p>
                <Button size="sm" onClick={() => window.dispatchEvent(new Event("aprimo:open-config"))}>
                  <LogIn className="h-4 w-4 mr-1.5" /> Connect
                </Button>
              </div>
            </ReportCard>
          )}
          {forbidden && (
            <ReportCard title="Not an admin">
              <p className="text-sm text-muted-foreground">{forbidden} Add the login to <code className="font-mono text-xs">REPORT_LABS_ADMINS</code> on the Vercel project to grant access.</p>
            </ReportCard>
          )}
          {error && <ErrorNote message={error} />}
          {loading && !data && <LoadingBlock height={240} />}

          {data && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiTile label="Questions" value={stats.questions} icon={<MessageSquare className="h-4 w-4" />} colorVar="--rl-1" />
                <KpiTile label="People" value={stats.people} icon={<Users className="h-4 w-4" />} colorVar="--rl-3" />
                <KpiTile label="Dashboards proposed" value={stats.proposed} icon={<LayoutDashboard className="h-4 w-4" />} colorVar="--rl-5" />
                <KpiTile label="Dashboards saved" value={stats.saved} hint="all time, by the assistant" icon={<Save className="h-4 w-4" />} colorVar="--rl-4" />
                <KpiTile label="Median answer time" value={stats.median} format={(n) => (n == null ? "–" : `${n.toFixed(0)}s`)} icon={<Timer className="h-4 w-4" />} colorVar="--rl-2" />
                <KpiTile label="Errors" value={stats.errors} hint={stats.tokens ? `${formatInt(stats.tokens)} tokens` : undefined} icon={<TriangleAlert className="h-4 w-4" />} colorVar="--rl-bad" />
              </div>

              <ReportCard
                title="Direction"
                subtitle={data.insight ? `Claude's read of the log, generated ${fmtWhen(data.insight.created_at)} by ${data.insight.generated_by ?? "admin"} over ${data.insight.window_days ?? "all"} days.` : "Ask Claude to read the question log and recommend which base reports to build next."}
                loading={generating}
                actions={
                  <Button size="sm" variant={data.insight ? "outline" : "default"} onClick={regenerate} disabled={generating || rows.length === 0}>
                    {data.insight ? <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    {data.insight ? "Regenerate" : "Generate"} for {win ? `${win} days` : "all time"}
                  </Button>
                }
              >
                {genError && <ErrorNote message={genError} />}
                {data.insight ? <Markdown text={data.insight.markdown} /> : <EmptyNote>{rows.length ? "No analysis yet." : "No questions in this window."}</EmptyNote>}
              </ReportCard>

              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                <ReportCard title="Themes" subtitle={`What questions are about. ${stats.unclassified ? `${stats.unclassified} not yet classified.` : "Every question classified."}`}>
                  <DataTable<ThemeRow>
                    columns={[
                      { key: "intent", header: "Theme", render: (r) => <span className="font-medium">{r.intent}</span> },
                      { key: "questions", header: "Questions", align: "right" },
                      { key: "people", header: "People", align: "right" },
                      { key: "dashboards", header: "Wanted a dashboard", align: "right" },
                      {
                        key: "coveredBy",
                        header: "Covered by",
                        render: (r) => (r.gap ? <span className="text-[var(--rl-2)] font-medium">Gap</span> : <span className="text-muted-foreground">{r.coveredBy}</span>),
                      },
                      { key: "sample", header: "Example", render: (r) => <span className="text-muted-foreground line-clamp-2 max-w-md">{r.sample}</span> },
                    ]}
                    rows={themes}
                    rowKey={(r) => r.intent}
                    initialRows={20}
                    exportName="assistant-themes"
                    emptyMessage="No questions in this window."
                    dense
                  />
                </ReportCard>
                <ReportCard title="Coverage by standard report" subtitle="How often a question was one an existing report already answers.">
                  {coverage.some((c) => c.questions) ? (
                    <RankedBars data={coverage.filter((c) => c.questions).map((c) => ({ label: c.report, value: c.questions }))} colorVar="--rl-3" labelWidth={170} />
                  ) : (
                    <EmptyNote>No question in this window mapped to a standard report.</EmptyNote>
                  )}
                  {coverage.some((c) => !c.questions) && (
                    <p className="text-xs text-muted-foreground">Never asked about: {coverage.filter((c) => !c.questions).map((c) => c.report).join(", ")}.</p>
                  )}
                </ReportCard>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <ReportCard title="Questions per day">
                  {byDay.length ? <ColumnChart data={byDay} colorVar="--rl-1" height={200} /> : <EmptyNote>Nothing yet.</EmptyNote>}
                </ReportCard>
                <ReportCard title="Topics" subtitle="Tags pulled from the questions.">
                  {topics.length ? <RankedBars data={topics} colorVar="--rl-5" labelWidth={130} /> : <EmptyNote>Nothing classified yet.</EmptyNote>}
                </ReportCard>
                <ReportCard title="Tools the assistant used">
                  {tools.length ? <RankedBars data={tools} colorVar="--rl-4" labelWidth={150} /> : <EmptyNote>Nothing yet.</EmptyNote>}
                </ReportCard>
              </div>

              <ReportCard title="Questions" subtitle="Full text, newest first. Nothing else about the conversation is stored.">
                <DataTable<QuestionRow>
                  columns={[
                    { key: "at", header: "When", render: (r) => <span className="whitespace-nowrap text-muted-foreground">{fmtWhen(r.at)}</span> },
                    { key: "login", header: "Who" },
                    { key: "question", header: "Question", render: (r) => <span className="block max-w-xl">{r.question}</span> },
                    { key: "intent", header: "Theme", render: (r) => <span className="text-muted-foreground">{r.intent}</span> },
                    { key: "context", header: "Opened from", render: (r) => <span className="text-muted-foreground whitespace-nowrap">{r.context}</span> },
                    { key: "covered", header: "Covered by", render: (r) => <span className="text-muted-foreground whitespace-nowrap">{r.covered}</span> },
                    {
                      key: "outcome",
                      header: "Outcome",
                      render: (r) => <span className={r.outcome === "error" ? "text-destructive" : r.outcome === "dashboard" ? "text-[var(--rl-5)]" : "text-muted-foreground"}>{r.outcome}</span>,
                    },
                    { key: "toolCount", header: "Tools", align: "right" },
                    { key: "seconds", header: "Seconds", align: "right" },
                  ]}
                  rows={questionRows}
                  rowKey={(r) => r.id}
                  initialRows={25}
                  exportName="assistant-questions"
                  emptyMessage="No questions in this window."
                  dense
                />
              </ReportCard>

              <div className="grid gap-4 lg:grid-cols-2">
                <ReportCard title="People">
                  <DataTable<PersonRow>
                    columns={[
                      { key: "login", header: "Login" },
                      { key: "questions", header: "Questions", align: "right" },
                      { key: "dashboards", header: "Dashboards", align: "right" },
                      { key: "errors", header: "Errors", align: "right" },
                      { key: "first", header: "First", render: (r) => <span className="text-muted-foreground whitespace-nowrap">{fmtWhen(r.first)}</span> },
                      { key: "last", header: "Last", render: (r) => <span className="text-muted-foreground whitespace-nowrap">{fmtWhen(r.last)}</span> },
                    ]}
                    rows={people}
                    rowKey={(r) => r.login}
                    initialRows={15}
                    emptyMessage="Nobody in this window."
                    dense
                  />
                </ReportCard>
                <ReportCard title="Saved dashboards, all users" subtitle="What people chose to keep.">
                  <DataTable
                    columns={[
                      { key: "title", header: "Title" },
                      { key: "user_login", header: "Who" },
                      { key: "source", header: "Source", render: (r) => <span className="text-muted-foreground">{String(r.source)}</span> },
                      { key: "pinned", header: "Pinned", render: (r) => <span className="text-muted-foreground">{r.pinned ? "yes" : ""}</span> },
                      { key: "updated_at", header: "Updated", render: (r) => <span className="text-muted-foreground whitespace-nowrap">{fmtWhen(String(r.updated_at))}</span> },
                    ]}
                    rows={data.savedReports as unknown as Record<string, unknown>[]}
                    rowKey={(r) => String(r.id)}
                    initialRows={15}
                    emptyMessage="No saved dashboards yet."
                    dense
                  />
                </ReportCard>
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground">
            <Link href="/" className="underline underline-offset-2 hover:text-foreground">Back to Report Labs</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
