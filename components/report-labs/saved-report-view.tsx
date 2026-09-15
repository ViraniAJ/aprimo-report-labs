"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react"
import { useReportParams } from "@/components/report-labs/report-context"
import { ReportCard, ErrorNote } from "@/components/report-labs/ui"
import { HtmlReportFrame } from "@/components/report-labs/html-report-frame"
import { savedReports, type SavedReport } from "@/lib/saved-reports"
import { runSpec, validateSpec, type RunOutput } from "@/lib/report-spec"
import { Button } from "@/components/ui/button"

/** Loads a saved report, runs its data spec as the user, and feeds the view. */
export function SavedReportView({ id }: { id: string }) {
  const p = useReportParams()
  const [report, setReport] = useState<SavedReport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<RunOutput | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    let cancelled = false
    setReport(null)
    setData(null)
    setLoadError(null)
    savedReports
      .get(p.environment, p.accessToken, id)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [id, p.environment, p.accessToken])

  const refresh = useCallback(async () => {
    if (!report) return
    if (!validateSpec(report.spec)) {
      setLoadError("This report's data spec is not valid.")
      return
    }
    setRunning(true)
    try {
      setData(await runSpec(report.spec, { environment: p.environment, authHeader: p.authHeader, client: p.client, dateRangeKey: p.dateRangeKey }))
    } finally {
      setRunning(false)
    }
  }, [report, p.environment, p.authHeader, p.client, p.dateRangeKey])

  useEffect(() => {
    refresh()
  }, [refresh, p.refreshToken])

  if (loadError) return <ReportCard title="Saved report" error={loadError} />
  if (!report)
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )

  const failed = data ? Object.values(data.results).filter((r) => r.error) : []
  const totalMs = data ? Math.max(0, ...Object.values(data.results).map((r) => r.ms)) : 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {running ? "Refreshing from Aprimo…" : data ? `Refreshed ${new Date(data.refreshedAt).toLocaleTimeString()} · ${Object.keys(data.results).length} queries · ${totalMs} ms` : "Not run yet"}
        </span>
        {data?.range && <span>· {data.range[0]} to {data.range[1]}</span>}
        {failed.length > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <TriangleAlert className="h-3.5 w-3.5" /> {failed.length} {failed.length === 1 ? "query" : "queries"} failed: {failed.map((f) => f.id).join(", ")}
          </span>
        )}
        <Button variant="ghost" size="sm" className="h-7 ml-auto" onClick={refresh} disabled={running}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>
      {report.view === "html" && report.html ? (
        <HtmlReportFrame html={report.html} data={data} title={report.title} />
      ) : (
        <ErrorNote message="This report uses the standard view, which is not available yet." />
      )}
      {failed.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Query errors</summary>
          <ul className="mt-1 font-mono break-all list-disc pl-5">
            {failed.map((f) => (
              <li key={f.id}>
                {f.id}: {f.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
