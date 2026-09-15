"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAprimo } from "@/context/aprimo-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TopBar } from "@/components/topbar"
import { LabsMark } from "@/components/brand"
import { Activity, BookOpen, ChevronRight, Library, Loader2, LogIn, RefreshCw, ShieldCheck, Sparkles, Table2, Zap } from "lucide-react"

import { REPORTS, REPORT_GROUPS, getReport, type ReportDef, type ReportGroup } from "@/lib/registry"
import { DATE_RANGE_OPTIONS, getDateRange, getPriorRange, getGranularity, type DateRangeKey } from "@/lib/analytics"
import { listCollections, type CollectionInfo } from "@/lib/core"
import { ReportProvider, type ReportParams } from "@/components/report-labs/report-context"
import { AssistantPanel } from "@/components/report-labs/assistant-panel"
import { SavedReportView } from "@/components/report-labs/saved-report-view"
import { savedReports, SavedReportsUnavailable, type SavedReportSummary, type SavedReport } from "@/lib/saved-reports"
import { Bookmark, Pencil, Pin, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { ExecutiveOverview } from "@/components/reports/executive-overview"
import { AssetPerformance } from "@/components/reports/asset-performance"
import { ZeroEngagement } from "@/components/reports/zero-engagement"
import { UserAdoption } from "@/components/reports/user-adoption"
import { PublicLinkTraffic } from "@/components/reports/public-link-traffic"
import { FormatDemand } from "@/components/reports/format-demand"
import { VideoPerformance } from "@/components/reports/video-performance"
import { ClassificationEngagement } from "@/components/reports/classification-engagement"
import { LibraryComposition } from "@/components/reports/library-composition"
import { LibraryGrowth } from "@/components/reports/library-growth"
import { ContentFreshness } from "@/components/reports/content-freshness"
import { DataModel } from "@/components/reports/data-model"
import { Duplicates } from "@/components/reports/duplicates"
import { Diagnostics } from "@/components/reports/diagnostics"

const COMPONENTS: Record<string, React.ComponentType> = {
  "executive-overview": ExecutiveOverview,
  "asset-performance": AssetPerformance,
  "zero-engagement": ZeroEngagement,
  "user-adoption": UserAdoption,
  "public-link-traffic": PublicLinkTraffic,
  "format-demand": FormatDemand,
  "classification-engagement": ClassificationEngagement,
  "video-performance": VideoPerformance,
  "library-composition": LibraryComposition,
  "library-growth": LibraryGrowth,
  "content-freshness": ContentFreshness,
  "duplicates": Duplicates,
  "data-model": DataModel,
  "diagnostics": Diagnostics,
}

const GROUP_ICONS: Record<ReportGroup, React.ComponentType<{ className?: string }>> = {
  Engagement: Activity,
  Library: Library,
  Reference: BookOpen,
}

function Workspace() {
  const { isConnected, connection, getAuthHeader, client } = useAprimo()
  const router = useRouter()
  const searchParams = useSearchParams()
  const reportId = searchParams.get("report")
  const report = getReport(reportId)
  const savedId = searchParams.get("saved")

  const [dateRangeKey, setDateRangeKey] = useState<DateRangeKey>("30d")
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const [collections, setCollections] = useState<CollectionInfo[]>([])
  const [refreshToken, setRefreshToken] = useState(0)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [saved, setSaved] = useState<SavedReportSummary[] | null>(null)
  const [openSavedReport, setOpenSavedReport] = useState<SavedReport | null>(null)

  // Full copy of the saved report being viewed, so the assistant can edit it in place.
  useEffect(() => {
    if (!savedId || !connection || !isConnected) {
      setOpenSavedReport(null)
      return
    }
    let cancelled = false
    savedReports
      .get(connection.environment, connection.accessToken, savedId)
      .then((r) => !cancelled && setOpenSavedReport(r))
      .catch(() => !cancelled && setOpenSavedReport(null))
    return () => {
      cancelled = true
    }
  }, [savedId, connection, isConnected, saved])

  const reloadSaved = useCallback(async () => {
    if (!connection || !isConnected) return
    try {
      setSaved(await savedReports.list(connection.environment, connection.accessToken))
    } catch (e) {
      if (!(e instanceof SavedReportsUnavailable)) console.error(e)
      setSaved(null)
    }
  }, [connection, isConnected])

  useEffect(() => {
    reloadSaved()
    window.addEventListener("rl:saved-reports-changed", reloadSaved)
    return () => window.removeEventListener("rl:saved-reports-changed", reloadSaved)
  }, [reloadSaved])

  useEffect(() => {
    if (!client || !isConnected) return
    let cancelled = false
    listCollections(client)
      .then((c) => !cancelled && setCollections(c))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client, isConnected])

  const navigate = useCallback((id: string | null) => router.push(id ? `/?report=${id}` : "/"), [router])
  const openSaved = useCallback((id: string) => router.push(`/?saved=${id}`), [router])

  const authHeader = getAuthHeader()
  const params: ReportParams | null = useMemo(() => {
    if (!connection || !authHeader || !client) return null
    const range = getDateRange(dateRangeKey)
    return {
      environment: connection.environment,
      authHeader,
      accessToken: connection.accessToken,
      client,
      dateRangeKey,
      range,
      priorRange: range ? getPriorRange(range) : undefined,
      granularity: getGranularity(dateRangeKey),
      collectionId,
      collections,
      refreshToken,
    }
  }, [connection, authHeader, client, dateRangeKey, collectionId, collections, refreshToken])

  if (!isConnected || !params) return <Landing />

  const Component = report ? COMPONENTS[report.id] : null
  const collectionName = collections.find((c) => c.id === collectionId)?.name ?? null
  const savedReport = savedId ? saved?.find((r) => r.id === savedId) ?? null : null
  const pinSaved = async (r: SavedReportSummary) => {
    try {
      await savedReports.pin(params.environment, params.accessToken, r.id, !r.pinned)
      reloadSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update")
    }
  }
  const deleteSaved = async (r: SavedReportSummary) => {
    if (!window.confirm(`Delete saved report "${r.title}"?`)) return
    try {
      await savedReports.remove(params.environment, params.accessToken, r.id)
      toast.success("Report deleted")
      reloadSaved()
      if (savedId === r.id) navigate(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete")
    }
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-card min-h-0">
        <nav className="flex-1 overflow-y-auto py-3">
          <button
            onClick={() => navigate(null)}
            className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${!report ? "font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Table2 className="h-4 w-4" /> All reports
          </button>
          {saved && saved.length > 0 && (
            <div className="mt-3">
              <div className="px-4 py-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5">
                <Bookmark className="h-3 w-3" /> Saved reports
              </div>
              {saved.map((r) => {
                const active = savedId === r.id
                return (
                  <button
                    key={r.id}
                    onClick={() => openSaved(r.id)}
                    className={`w-full text-left pl-4 pr-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                    title={r.description ?? r.title}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${active ? "bg-signal" : "bg-transparent"}`} />
                    <span className="truncate">{r.title}</span>
                    {r.pinned && <Pin className="h-3 w-3 ml-auto shrink-0 text-muted-foreground" />}
                  </button>
                )
              })}
            </div>
          )}
          {REPORT_GROUPS.map((g) => {
            const Icon = GROUP_ICONS[g]
            return (
              <div key={g} className="mt-3">
                <div className="px-4 py-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5">
                  <Icon className="h-3 w-3" /> {g}
                </div>
                {REPORTS.filter((r) => r.group === g).map((r) => {
                  const active = report?.id === r.id
                  return (
                    <button
                      key={r.id}
                      onClick={() => navigate(r.id)}
                      className={`w-full text-left pl-4 pr-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${active ? "bg-signal" : "bg-transparent"}`} />
                      {r.title}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>
        <div className="border-t border-border p-3">
          <Button variant={assistantOpen ? "secondary" : "default"} size="sm" className="w-full" onClick={() => setAssistantOpen((o) => !o)}>
            <Sparkles className="h-4 w-4 mr-2" /> {assistantOpen ? "Hide assistant" : "Ask a question"}
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="border-b border-border bg-background px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <button onClick={() => navigate(null)} className="hover:text-foreground">Reports</button>
              {report && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span>{report.group}</span>
                </>
              )}
              {savedId && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span>Saved reports</span>
                </>
              )}
            </div>
            <h1 className="text-lg font-semibold leading-tight truncate tracking-tight">{report ? report.title : savedReport ? savedReport.title : savedId ? "Saved report" : "All reports"}</h1>
            {report && <p className="text-xs text-muted-foreground truncate">{report.description}</p>}
            {savedReport?.description && <p className="text-xs text-muted-foreground truncate">{savedReport.description}</p>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {savedReport && (
              <>
                <Button variant="ghost" size="sm" className="h-8" onClick={() => setAssistantOpen(true)} title="Edit this report with the assistant">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8" onClick={() => pinSaved(savedReport)} title={savedReport.pinned ? "Unpin" : "Pin to top"}>
                  <Pin className={`h-4 w-4 ${savedReport.pinned ? "" : "text-muted-foreground"}`} style={savedReport.pinned ? { color: "var(--rl-good)" } : undefined} />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => deleteSaved(savedReport)} title="Delete saved report">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
            {(!report || report.usesDateRange) && (
              <select value={dateRangeKey} onChange={(e) => setDateRangeKey(e.target.value as DateRangeKey)} className="h-8 rounded-md border border-border bg-card px-2 text-sm" title="Date range">
                {DATE_RANGE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            )}
            {report?.usesCollection && collections.length > 0 && (
              <select value={collectionId ?? ""} onChange={(e) => setCollectionId(e.target.value || null)} className="h-8 max-w-[220px] rounded-md border border-border bg-card px-2 text-sm" title="Collection scope">
                <option value="">All collections</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            {(report || savedId) && (
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setRefreshToken((t) => t + 1)} title="Refresh">
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
            <Button variant={assistantOpen ? "secondary" : "outline"} size="sm" className="h-8 lg:hidden" onClick={() => setAssistantOpen((o) => !o)}>
              <Sparkles className="h-4 w-4 mr-1" /> Ask
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
            <ReportProvider value={params}>
              {Component ? (
                <Component key={`${report!.id}-${refreshToken}`} />
              ) : savedId ? (
                <SavedReportView key={savedId} id={savedId} />
              ) : (
                <Catalogue onOpen={navigate} onAsk={() => setAssistantOpen(true)} saved={saved ?? []} onOpenSaved={openSaved} />
              )}
            </ReportProvider>
          </div>
          {assistantOpen && (
            <div className="w-full sm:w-[420px] xl:w-[460px] shrink-0 h-full min-h-0">
              <AssistantPanel
                context={{
                  environment: params.environment,
                  accessToken: params.accessToken,
                  authHeader: params.authHeader,
                  client: params.client,
                  editingReport: openSavedReport && openSavedReport.id === savedId && openSavedReport.html ? { id: openSavedReport.id, title: openSavedReport.title, description: openSavedReport.description, spec: openSavedReport.spec, html: openSavedReport.html } : undefined,
                  reportId: report?.id,
                  reportTitle: report?.title,
                  dateRangeKey,
                  dateRange: report && !report.usesDateRange ? undefined : params.range,
                  collectionName: report?.usesCollection ? collectionName : null,
                }}
                onClose={() => setAssistantOpen(false)}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function Catalogue({ onOpen, onAsk, saved, onOpenSaved }: { onOpen: (id: string) => void; onAsk: () => void; saved: SavedReportSummary[]; onOpenSaved: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-7 max-w-6xl">
      {saved.length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5 mb-2">
            <Bookmark className="h-3.5 w-3.5" /> Your saved reports
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {saved.map((r) => (
              <button key={r.id} onClick={() => onOpenSaved(r.id)} className="text-left rounded-lg border border-border bg-card p-4 hover:border-foreground/40 transition-colors flex flex-col gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{r.title}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono shrink-0">{r.view === "html" ? "dashboard" : "report"}</Badge>
                </div>
                {r.description && <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{r.description}</p>}
                <span className="text-[11px] text-muted-foreground mt-auto">Updated {new Date(r.updated_at).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <p className="text-sm text-muted-foreground flex-1 max-w-2xl">
          Every figure is queried from Aprimo when you open a report, as you, with your permissions. Pick a report, or ask in plain language.
        </p>
        <Button onClick={onAsk} size="sm">
          <Sparkles className="h-4 w-4 mr-2" /> Ask a question
        </Button>
      </div>
      {REPORT_GROUPS.map((g) => {
        const Icon = GROUP_ICONS[g]
        return (
          <section key={g}>
            <h3 className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5 mb-2">
              <Icon className="h-3.5 w-3.5" /> {g}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {REPORTS.filter((r) => r.group === g).map((r) => (
                <ReportTile key={r.id} report={r} onOpen={onOpen} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function ReportTile({ report, onOpen }: { report: ReportDef; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(report.id)} className="text-left rounded-lg border border-border bg-card p-4 hover:border-foreground/40 transition-colors flex flex-col gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{report.title}</span>
        <span className="flex gap-1">
          {report.sources.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{s}</Badge>
          ))}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{report.description}</p>
    </button>
  )
}

function Landing() {
  const connect = () => window.dispatchEvent(new Event("aprimo:open-config"))
  return (
    <main className="flex-1 min-h-0 overflow-y-auto">
      <section className="px-6 pt-14 pb-10 max-w-5xl mx-auto">
        <div className="flex items-start gap-5">
          <LabsMark className="h-12 w-12 shrink-0 mt-1" />
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">For Aprimo DAM</p>
            <h1 className="text-3xl sm:text-[40px] font-semibold tracking-tight leading-[1.1] max-w-2xl" style={{ textWrap: "balance" }}>
              See how your Aprimo content performs.
            </h1>
            <p className="mt-4 text-base text-muted-foreground max-w-xl leading-relaxed">
              Report Labs extends Aprimo DAM with live reports built on the Analytics and Core APIs, and an assistant that answers questions about usage and the library in plain language. It runs as you, and stores nothing.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Button onClick={connect}>
                <LogIn className="h-4 w-4 mr-2" /> Connect to Aprimo
              </Button>
              <span className="text-xs text-muted-foreground">Uses your existing Aprimo login.</span>
            </div>
          </div>
        </div>
      </section>
      <section className="px-6 pb-16 max-w-5xl mx-auto grid gap-4 sm:grid-cols-3">
        <Feature icon={<Zap className="h-4 w-4" />} title="Live from Aprimo" body="Every number is queried from your environment the moment you open a report. Change the date range or scope and it re-queries." />
        <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Your permissions apply" body="Reports and the assistant call Aprimo with your own login, so you only ever see what Aprimo lets you see." />
        <Feature icon={<Sparkles className="h-4 w-4" />} title="Ask in plain language" body="Which assets were downloaded most last quarter, and by whom? The assistant runs the queries and shows its work." />
      </section>
      <section className="px-6 pb-20 max-w-5xl mx-auto">
        <h2 className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-3">What's inside</h2>
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {REPORTS.map((r) => (
            <div key={r.id} className="flex items-baseline gap-2 py-1 border-b border-border/70">
              <span className="font-medium">{r.title}</span>
              <span className="text-xs text-muted-foreground ml-auto font-mono">{r.sources.join(" + ")}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-foreground">{icon}</span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  )
}

export default function Page() {
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <TopBar />
      <Suspense
        fallback={
          <main className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </main>
        }
      >
        <Workspace />
      </Suspense>
    </div>
  )
}
