"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useReportParams } from "@/components/report-labs/report-context"
import { ReportCard, DataTable, ShareBar, LoadingBlock } from "@/components/report-labs/ui"
import { RankedBars } from "@/components/report-labs/charts"
import { RecordCell } from "@/components/report-labs/record-cell"
import { queryAnalytics, queryRanked, num, str, formatInt } from "@/lib/analytics"
import { cardsFromRows, hydrateThumbnails, type RecordCard } from "@/lib/core"

// Engagement by classification, with drill-down to the assets in one
// classification. Classifications.name joins onto the engagement cubes; a
// record counts once per classification it belongs to, which is the right
// semantics for "how much did this classification get used".

type Metric = "views" | "downloads"
const METRICS: Record<Metric, { label: string; measure: string; recordDim: string; timeDim: string; colorVar: string }> = {
  views: { label: "Views", measure: "Views.count", recordDim: "Views.recordId", timeDim: "DateDimension.date", colorVar: "--rl-1" },
  downloads: { label: "Downloads", measure: "Downloads.count", recordDim: "Downloads.recordId", timeDim: "Downloads.downloadDate", colorVar: "--rl-2" },
}

interface ClassRow extends Record<string, unknown> {
  name: string
  count: number
  share: number
}
interface AssetRow extends Record<string, unknown> {
  recordId: string
  count: number
}

export function ClassificationEngagement() {
  const p = useReportParams()
  const [metric, setMetric] = useState<Metric>("downloads")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ClassRow[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [cards, setCards] = useState<Map<string, RecordCard>>(new Map())

  const m = METRICS[metric]

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setSelected(null)
      try {
        const timeDimensions = p.range ? [{ dimension: m.timeDim, dateRange: p.range }] : []
        const [t, r] = await Promise.all([
          queryAnalytics(p.environment, p.authHeader, { measures: [m.measure], timeDimensions }),
          queryAnalytics(p.environment, p.authHeader, { measures: [m.measure], dimensions: ["Classifications.name"], timeDimensions, order: { [m.measure]: "desc" }, limit: 100 }),
        ])
        if (cancelled) return
        const tot = num(t[0]?.[m.measure])
        setTotal(tot)
        setRows(r.map((x) => ({ name: str(x["Classifications.name"]) || "(unclassified)", count: num(x[m.measure]), share: tot ? (num(x[m.measure]) / tot) * 100 : 0 })).filter((x) => x.count > 0))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.environment, p.authHeader, p.dateRangeKey, p.refreshToken, metric])

  // Drill-down: top assets within the selected classification.
  useEffect(() => {
    if (!selected) {
      setAssets([])
      return
    }
    let cancelled = false
    async function load() {
      setAssetsLoading(true)
      try {
        const timeDimensions = p.range ? [{ dimension: m.timeDim, dateRange: p.range }] : []
        const ranked = await queryRanked(p.environment, p.authHeader, {
          measures: [m.measure],
          dimensions: [m.recordDim],
          filters: [{ member: "Classifications.name", operator: "equals", values: [selected!] }],
          timeDimensions,
          order: { [m.measure]: "desc" },
          limit: 25,
        })
        if (cancelled) return
        const a = ranked.rows.map((r) => ({ recordId: str(r[m.recordDim]), count: num(r[m.measure]) })).filter((r) => r.recordId)
        setAssets(a)
        const initial = ranked.joined ? cardsFromRows(ranked.rows, m.recordDim, p.environment) : new Map<string, RecordCard>()
        setCards(initial)
        setAssetsLoading(false)
        const map = await hydrateThumbnails(p.client, initial, a.map((r) => r.recordId), 25)
        if (!cancelled) setCards(map)
      } catch {
        if (!cancelled) setAssetsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, metric, p.dateRangeKey, p.refreshToken])

  const max = rows[0]?.count ?? 0
  const maxA = assets[0]?.count ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          {(Object.keys(METRICS) as Metric[]).map((k) => (
            <button key={k} onClick={() => setMetric(k)} className={`px-3 py-1.5 transition-colors ${metric === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {METRICS[k].label}
            </button>
          ))}
        </div>
        {!loading && !error && <span className="text-xs text-muted-foreground">{formatInt(total)} {m.label.toLowerCase()} in period across {rows.length} classifications. Click a row to see its assets.</span>}
      </div>
      {error && <ReportCard title="Classification engagement" error={error} />}
      <div className="grid gap-4 xl:grid-cols-5">
        <ReportCard title={`Top classifications by ${m.label.toLowerCase()}`} className="xl:col-span-2" loading={loading}>
          {loading ? <LoadingBlock height={320} /> : <RankedBars data={rows.slice(0, 12).map((r) => ({ label: r.name, value: r.count }))} colorVar={m.colorVar} labelWidth={170} />}
        </ReportCard>
        <ReportCard title="All classifications" className="xl:col-span-3" loading={loading}>
          <DataTable<ClassRow>
            rows={rows}
            rowKey={(r) => r.name}
            initialRows={15}
            exportName={`classification-${metric}`}
            dense
            columns={[
              { key: "name", header: "Classification", render: (r) => (
                <button onClick={() => setSelected(r.name === selected ? null : r.name)} className={`text-left hover:underline ${selected === r.name ? "font-medium" : ""}`}>{r.name}</button>
              ) },
              { key: "count", header: m.label, align: "right", width: "200px", render: (r) => (
                <div className="flex items-center gap-2 justify-end">
                  <span className="w-14 text-right tabular-nums">{formatInt(r.count)}</span>
                  <div className="w-24"><ShareBar value={r.count} max={max} colorVar={m.colorVar} /></div>
                </div>
              ) },
              { key: "share", header: "Share", align: "right", render: (r) => `${r.share.toFixed(1)}%` },
            ]}
          />
        </ReportCard>
      </div>
      {selected && (
        <ReportCard
          title={`Top assets in "${selected}"`}
          subtitle={`By ${m.label.toLowerCase()} in the period`}
          loading={assetsLoading}
          actions={
            <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground" title="Close">
              <X className="h-4 w-4" />
            </button>
          }
        >
          <DataTable<AssetRow>
            rows={assets}
            rowKey={(r) => r.recordId}
            initialRows={25}
            exportName={`classification-${metric}-assets`}
            columns={[
              { key: "recordId", header: "Asset", render: (r) => <RecordCell card={cards.get(r.recordId)} fallbackId={r.recordId} environment={p.environment} />, exportValue: (r) => cards.get(r.recordId)?.title ?? r.recordId },
              { key: "count", header: m.label, align: "right", width: "200px", render: (r) => (
                <div className="flex items-center gap-2 justify-end">
                  <span className="w-14 text-right tabular-nums">{formatInt(r.count)}</span>
                  <div className="w-24"><ShareBar value={r.count} max={maxA} colorVar={m.colorVar} /></div>
                </div>
              ) },
            ]}
          />
        </ReportCard>
      )}
    </div>
  )
}
