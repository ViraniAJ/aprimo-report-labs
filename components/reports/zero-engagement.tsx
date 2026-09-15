"use client"

import { useEffect, useState } from "react"
import { EyeOff, Download, Layers, Activity } from "lucide-react"
import { useReportParams } from "@/components/report-labs/report-context"
import { KpiTile, ReportCard, DataTable, LoadingBlock } from "@/components/report-labs/ui"
import { RankedBars, ColumnChart } from "@/components/report-labs/charts"
import { RecordCell } from "@/components/report-labs/record-cell"
import { queryAnalytics, num, str, analyticsId, extractDate, formatBucket, formatInt, TITLE_DIM } from "@/lib/analytics"
import { countRecords, searchRecordCards, resolveUserNames, ALL_RECORDS_EXPRESSION, dateLiteral, type RecordCard } from "@/lib/core"

// Zero engagement, exact: the Analytics API keeps ZeroViewRecords and
// ZeroDownloadRecords cubes of records that have never been viewed or
// downloaded. If a tenant's schema lacks them, the report falls back to the
// period-based approximation (library minus records engaged in the range).

type Mode = "views" | "downloads"

const CUBE: Record<Mode, { cube: string; label: string; verb: string; colorVar: string }> = {
  views: { cube: "ZeroViewRecords", label: "Never viewed", verb: "viewed", colorVar: "--rl-1" },
  downloads: { cube: "ZeroDownloadRecords", label: "Never downloaded", verb: "downloaded", colorVar: "--rl-2" },
}

interface TypeRow extends Record<string, unknown> {
  contentType: string
  count: number
  share: number
}
interface OldRow extends Record<string, unknown> {
  title: string
  contentType: string
  createUser: string
  createUserId: string
  createDate: string
  ageDays: number
}

export function ZeroEngagement() {
  const p = useReportParams()
  const [mode, setMode] = useState<Mode>("views")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [zeroViews, setZeroViews] = useState<number | null>(null)
  const [zeroDownloads, setZeroDownloads] = useState<number | null>(null)
  const [byType, setByType] = useState<TypeRow[]>([])
  const [byYear, setByYear] = useState<Array<{ label: string; value: number }>>([])
  const [oldest, setOldest] = useState<OldRow[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const c = CUBE[mode]
        const q = (query: Parameters<typeof queryAnalytics>[2]) => queryAnalytics(p.environment, p.authHeader, query)
        // Totals for both cubes plus the library size; a cube error means the tenant lacks the cube.
        const [lib, zv, zd] = await Promise.all([
          countRecords(p.client, ALL_RECORDS_EXPRESSION),
          q({ measures: ["ZeroViewRecords.count"] }).then((r) => num(r[0]?.["ZeroViewRecords.count"])).catch(() => null),
          q({ measures: ["ZeroDownloadRecords.count"] }).then((r) => num(r[0]?.["ZeroDownloadRecords.count"])).catch(() => null),
        ])
        if (cancelled) return
        setTotal(lib)
        setZeroViews(zv)
        setZeroDownloads(zd)
        const ok = (mode === "views" ? zv : zd) != null
        setSupported(ok)
        if (!ok) {
          setLoading(false)
          return
        }
        const measure = `${c.cube}.count`
        const [types, years, old] = await Promise.all([
          q({ measures: [measure], dimensions: [`${c.cube}.contentType`], order: { [measure]: "desc" }, limit: 25 }),
          q({ measures: [measure], timeDimensions: [{ dimension: `${c.cube}.createDate`, granularity: "year" }], order: { [`${c.cube}.createDate`]: "asc" }, limit: 50 }).catch(() => []),
          // Prefer the user name joined in; fall back to the bare createUser id.
          q({ measures: [measure], dimensions: [TITLE_DIM, `${c.cube}.contentType`, `${c.cube}.createUser`, `${c.cube}.createDate`, "Users.firstName", "Users.lastName", "Users.loginId"], order: { [`${c.cube}.createDate`]: "asc" }, limit: 50 })
            .then((rows) => (rows.some((r) => str(r["Users.loginId"]) || str(r["Users.lastName"])) ? rows : Promise.reject(new Error("no user join"))))
            .catch(() => q({ measures: [measure], dimensions: [TITLE_DIM, `${c.cube}.contentType`, `${c.cube}.createUser`, `${c.cube}.createDate`], order: { [`${c.cube}.createDate`]: "asc" }, limit: 50 }).catch(() => [])),
        ])
        if (cancelled) return
        const zeroTotal = mode === "views" ? zv! : zd!
        setByType(types.map((r) => ({ contentType: str(r[`${c.cube}.contentType`]) || "(none)", count: num(r[measure]), share: zeroTotal ? (num(r[measure]) / zeroTotal) * 100 : 0 })))
        setByYear(years.map((r) => ({ label: formatBucket(extractDate(r, `${c.cube}.createDate`), "year"), value: num(r[measure]) })).filter((r) => r.label))
        const now = Date.now()
        const nameFromJoin = (r: Record<string, unknown>) => {
          const full = [str(r["Users.firstName"]), str(r["Users.lastName"])].filter(Boolean).join(" ").trim()
          const login = str(r["Users.loginId"])
          return full ? `${full}${login ? ` (${login})` : ""}` : login
        }
        const rows: OldRow[] = old.map((r) => {
          const created = str(r[`${c.cube}.createDate`]).slice(0, 10)
          return {
            title: str(r[TITLE_DIM]) || "(untitled)",
            contentType: str(r[`${c.cube}.contentType`]),
            createUser: nameFromJoin(r as Record<string, unknown>) || str(r[`${c.cube}.createUser`]),
            createUserId: str(r[`${c.cube}.createUser`]),
            createDate: created,
            ageDays: created ? Math.floor((now - new Date(created).getTime()) / 86400000) : 0,
          }
        })
        setOldest(rows)
        // Any creator still shown as a GUID gets resolved through the Core API.
        const unresolved = rows.filter((r) => /^[0-9a-f-]{32,36}$/i.test(r.createUser)).map((r) => r.createUserId)
        if (unresolved.length) {
          const names = await resolveUserNames(p.client, unresolved)
          if (cancelled) return
          setOldest(rows.map((r) => ({ ...r, createUser: names.get(r.createUserId.toLowerCase()) ?? r.createUser })))
        }
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
  }, [p.environment, p.authHeader, p.refreshToken, mode])

  if (supported === false) return <ZeroEngagementFallback />

  const c = CUBE[mode]
  const zero = mode === "views" ? zeroViews : zeroDownloads
  const pct = (n: number | null) => (n != null && total ? `${((n / total) * 100).toFixed(1)}% of library` : undefined)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          {(["views", "downloads"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {CUBE[m].label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Exact figures from the Analytics API. A record counts once it has ever been {c.verb}; the date range does not apply.</span>
      </div>
      {error && <ReportCard title="Zero engagement" error={error} />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Records in library" value={total} icon={<Layers className="h-4 w-4" />} colorVar="--rl-5" loading={loading} />
        <KpiTile label="Never viewed" value={zeroViews} hint={pct(zeroViews)} icon={<EyeOff className="h-4 w-4" />} colorVar="--rl-1" loading={loading} />
        <KpiTile label="Never downloaded" value={zeroDownloads} hint={pct(zeroDownloads)} icon={<Download className="h-4 w-4" />} colorVar="--rl-2" loading={loading} />
        <KpiTile label={`Ever ${c.verb}`} value={zero != null && total != null ? Math.max(0, total - zero) : null} hint={zero != null && total ? `${(((total - zero) / total) * 100).toFixed(1)}% of library` : undefined} icon={<Activity className="h-4 w-4" />} colorVar="--rl-3" loading={loading} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ReportCard title={`${c.label} by content type`} loading={loading}>
          {loading ? <LoadingBlock /> : <RankedBars data={byType.slice(0, 12).map((t) => ({ label: t.contentType, value: t.count }))} colorVar={c.colorVar} labelWidth={150} />}
        </ReportCard>
        <ReportCard title={`${c.label} by year created`} subtitle="Older unused content is the archive candidate" loading={loading}>
          {loading ? <LoadingBlock /> : byYear.length ? <ColumnChart data={byYear} colorVar={c.colorVar} /> : <p className="text-sm text-muted-foreground py-6 text-center">No creation dates available.</p>}
        </ReportCard>
      </div>
      <ReportCard title={`Oldest ${c.label.toLowerCase()} records`} subtitle="50 oldest by creation date" loading={loading}>
        <DataTable<OldRow>
          rows={oldest}
          rowKey={(r, i) => `${r.title}-${r.createDate}-${i}`}
          initialRows={15}
          exportName={`zero-${mode}-oldest`}
          dense
          columns={[
            { key: "title", header: "Asset" },
            { key: "contentType", header: "Type" },
            { key: "createUser", header: "Created by", render: (r) => (/^[0-9a-f-]{32,36}$/i.test(r.createUser) ? <span className="font-mono text-xs text-muted-foreground" title={r.createUser}>{r.createUser.slice(0, 8)}…</span> : <span title={r.createUserId}>{r.createUser}</span>) },
            { key: "createDate", header: "Created", align: "right" },
            { key: "ageDays", header: "Age (days)", align: "right", render: (r) => formatInt(r.ageDays) },
          ]}
        />
      </ReportCard>
      <ReportCard title={`${c.label}, all content types`} loading={loading}>
        <DataTable<TypeRow>
          rows={byType}
          rowKey={(r) => r.contentType}
          initialRows={10}
          exportName={`zero-${mode}-by-type`}
          dense
          columns={[
            { key: "contentType", header: "Content type" },
            { key: "count", header: c.label, align: "right", render: (r) => formatInt(r.count) },
            { key: "share", header: "Share", align: "right", render: (r) => `${r.share.toFixed(1)}%` },
          ]}
        />
      </ReportCard>
    </div>
  )
}

// ── Fallback: period-based approximation for tenants without the zero cubes ──

interface SampleRow extends Record<string, unknown> {
  id: string
  title: string
  contentType: string
  createdOn: string
  card: RecordCard
}

function ZeroEngagementFallback() {
  const p = useReportParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [engaged, setEngaged] = useState<number | null>(null)
  const [unused, setUnused] = useState<SampleRow[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const time = (dim: string) => (p.range ? [{ dimension: dim, dateRange: p.range }] : [])
        const [t, v, d] = await Promise.all([
          countRecords(p.client, ALL_RECORDS_EXPRESSION),
          queryAnalytics(p.environment, p.authHeader, { measures: ["Views.count"], dimensions: ["Views.recordId"], timeDimensions: time("DateDimension.date"), limit: 10000 }),
          queryAnalytics(p.environment, p.authHeader, { measures: ["Downloads.count"], dimensions: ["Downloads.recordId"], timeDimensions: time("Downloads.downloadDate"), limit: 10000 }),
        ])
        if (cancelled) return
        const ids = new Set([...v.map((r) => analyticsId(str(r["Views.recordId"]))), ...d.map((r) => analyticsId(str(r["Downloads.recordId"])))].filter(Boolean))
        setTotal(t)
        setEngaged(ids.size)
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 14)
        const sample = await searchRecordCards(p.client, `CreatedOn < ${dateLiteral(cutoff)}`, 200)
        if (cancelled) return
        setUnused(sample.items.filter((c) => !ids.has(c.key)).slice(0, 50).map((c) => ({ id: c.id, title: c.title, contentType: c.contentType ?? "", createdOn: (c.createdOn ?? "").slice(0, 10), card: c })))
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
  }, [p.environment, p.authHeader, p.dateRangeKey, p.refreshToken])

  const zero = total != null && engaged != null ? Math.max(0, total - engaged) : null
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">This environment does not expose the never-viewed cubes, so figures are for the selected date range: library records minus those viewed or downloaded in the period.</p>
      {error && <ReportCard title="Zero engagement" error={error} />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiTile label="Records in library" value={total} icon={<Layers className="h-4 w-4" />} colorVar="--rl-5" loading={loading} />
        <KpiTile label="Engaged in period" value={engaged} icon={<Activity className="h-4 w-4" />} colorVar="--rl-3" loading={loading} />
        <KpiTile label="No engagement in period" value={zero} hint={zero != null && total ? `${((zero / total) * 100).toFixed(1)}% of library` : undefined} icon={<EyeOff className="h-4 w-4" />} colorVar="--rl-2" loading={loading} />
      </div>
      <ReportCard title="Unused assets, recent sample" loading={loading}>
        <DataTable<SampleRow>
          rows={unused}
          rowKey={(r) => r.id}
          initialRows={20}
          exportName="zero-engagement-sample"
          columns={[
            { key: "title", header: "Asset", render: (r) => <RecordCell card={r.card} fallbackId={r.id} environment={p.environment} /> },
            { key: "contentType", header: "Type" },
            { key: "createdOn", header: "Created", align: "right" },
          ]}
        />
      </ReportCard>
    </div>
  )
}
