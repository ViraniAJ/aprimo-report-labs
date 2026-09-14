"use client"

import { useEffect, useMemo, useState } from "react"
import { Copy, Files, HardDrive, Layers, ExternalLink } from "lucide-react"
import { useReportParams } from "@/components/report-labs/report-context"
import { KpiTile, ReportCard, DataTable, LoadingBlock, ShareBar } from "@/components/report-labs/ui"
import { ColumnChart } from "@/components/report-labs/charts"
import { RecordCell } from "@/components/report-labs/record-cell"
import { formatBytes, formatInt } from "@/lib/analytics"
import { runThrottled, type RecordCard } from "@/lib/core"
import { Expander } from "aprimo-js"

// Read-only duplicate detection, matching the Editor Tools approach: facet on
// the _Checksum (or _Filename) field to find values shared by more than one
// record, then fetch those records to size the waste. Resolution (merging
// metadata, deleting the loser) stays in Editor Tools.

type MatchMode = "checksum" | "filename" | "both"

interface FieldDef {
  id: string
  name: string
  label?: string
  dataType?: string
}

interface Group extends Record<string, unknown> {
  key: string
  value: string
  fileName: string
  copies: number
  fileSize: number
  wasted: number
  records: RecordCard[]
  fetched: boolean
}

const FACET_BASE_EXPRESSION = "NOT id = ''"
const MAX_GROUPS_FETCHED = 200
const BATCH = 25

function matchesField(d: FieldDef, candidates: string[]): boolean {
  const n = (d.name ?? "").toLowerCase()
  const l = (d.label ?? "").toLowerCase()
  return candidates.some((c) => n === c || l === c || n.includes(c) || l.includes(c))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fieldValue(rec: any, fieldName: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = (rec._embedded?.fields?.items ?? []).find((x: any) => x.fieldName === fieldName)
  const lv = f?.localizedValues?.[0]
  if (!lv) return ""
  if (Array.isArray(lv.values)) return lv.values.join(", ")
  return lv.value ?? ""
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCard(rec: any): RecordCard & { fileSize: number; fileName: string } {
  const mflv = rec._embedded?.masterfilelatestversion
  return {
    id: rec.id,
    key: String(rec.id).replace(/-/g, "").toLowerCase(),
    title: rec.title || rec.id,
    contentType: rec.contentType,
    status: rec.status,
    createdOn: rec.createdOn,
    modifiedOn: rec.modifiedOn,
    thumbnail: mflv?._embedded?.thumbnail?.uri ?? mflv?._embedded?.preview?.uri,
    fileName: mflv?.fileName ?? "",
    fileSize: Number(mflv?.fileSize ?? 0) || 0,
  }
}

const EDITOR_TOOLS_URL = process.env.NEXT_PUBLIC_EDITOR_TOOLS_URL?.replace(/\/$/, "")

export function Duplicates() {
  const p = useReportParams()
  const [mode, setMode] = useState<MatchMode>("checksum")
  const [fieldDefs, setFieldDefs] = useState<FieldDef[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [facetTruncated, setFacetTruncated] = useState(false)

  // Field definitions once per environment
  useEffect(() => {
    let cancelled = false
    async function load() {
      const all: FieldDef[] = []
      try {
        for await (const page of p.client.fieldDefinitions.getPaged()) {
          if (!page.ok) break
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const d of (page.data?.items ?? []) as any[]) all.push({ id: d.id, name: d.name, label: d.label, dataType: d.dataType })
        }
        if (!cancelled) setFieldDefs(all)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [p.client, p.environment])

  const checksumField = useMemo(() => fieldDefs?.find((d) => matchesField(d, ["_checksum", "checksum", "crc32"])), [fieldDefs])
  const filenameField = useMemo(() => fieldDefs?.find((d) => matchesField(d, ["_filename", "filename"])), [fieldDefs])

  useEffect(() => {
    if (!fieldDefs) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setGroups([])
      try {
        const facetField = mode === "filename" ? filenameField : checksumField
        if (!facetField) {
          setLoading(false)
          return
        }
        const q = (s: string) => s.replace(/"/g, '""')
        const res = await p.client.search.records({
          searchExpression: { expression: FACET_BASE_EXPRESSION },
          facets: [{ name: "dupes", type: "textField", fieldId: facetField.id, maximumFacetValues: 5000 }],
          page: 1,
          pageSize: 1,
        } as unknown as Parameters<typeof p.client.search.records>[0])
        if (!res.ok) throw new Error((res as { error?: { message?: string } }).error?.message ?? "Facet search failed")
        const data = res.data as unknown as { facets?: Array<{ name?: string; values?: unknown[] }>; truncatedFacets?: string[] }
        const facet = (data.facets ?? [])[0]
        setFacetTruncated((data.truncatedFacets ?? []).length > 0)

        const counts = new Map<string, number>()
        for (const v of facet?.values ?? []) {
          if (v && typeof v === "object") {
            const o = v as { value?: unknown; key?: unknown; count?: number }
            const key = o.value ?? o.key
            if (key != null && (o.count ?? 0) > 1) counts.set(String(key), o.count ?? 0)
          }
        }
        if (cancelled) return

        // Groups from the facet alone; records are filled in for the largest groups.
        const initial: Group[] = Array.from(counts.entries())
          .map(([value, copies]) => ({ key: value, value, fileName: "", copies, fileSize: 0, wasted: 0, records: [], fetched: false }))
          .sort((a, b) => b.copies - a.copies)
        setGroups(initial)
        setLoading(false)

        // Fetch records for the top groups, in batches of values.
        const toFetch = initial.slice(0, MAX_GROUPS_FETCHED).map((g) => g.value)
        const expander = Expander.create()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .for<any>("Record")
          .expand("fields", "masterfilelatestversion")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .for<any>("FileVersion")
          .expand("thumbnail", "preview")
        const batches: string[][] = []
        for (let i = 0; i < toFetch.length; i += BATCH) batches.push(toFetch.slice(i, i + BATCH))
        const results = await runThrottled(
          batches.map((vals) => async () => {
            const expr = vals.map((c) => `FieldName("${q(facetField.name)}") = "${q(c)}"`).join(" OR ")
            const r = await p.client.search.records({ searchExpression: { expression: expr }, page: 1, pageSize: 500 } as never, expander as never)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return r.ok ? (((r.data as unknown as { items?: any[] })?.items ?? []) as any[]) : []
          }),
          3,
        )
        if (cancelled) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const recs: any[] = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))

        // Regroup by the facet value; in "both" mode split further by filename.
        const byKey = new Map<string, Group>()
        for (const rec of recs) {
          const v = fieldValue(rec, facetField.name)
          if (!v) continue
          const card = toCard(rec)
          const fn = (filenameField ? fieldValue(rec, filenameField.name) : "") || card.fileName
          const key = mode === "both" ? `${v}|${fn}` : v
          const g = byKey.get(key) ?? { key, value: v, fileName: fn, copies: 0, fileSize: 0, wasted: 0, records: [], fetched: true }
          g.records.push(card)
          g.copies = g.records.length
          g.fileSize = Math.max(g.fileSize, card.fileSize)
          g.fileName = g.fileName || fn
          byKey.set(key, g)
        }
        const fetchedGroups = Array.from(byKey.values())
          .filter((g) => g.records.length > 1)
          .map((g) => ({ ...g, wasted: g.fileSize * (g.records.length - 1) }))
        const fetchedKeys = new Set(fetchedGroups.map((g) => g.value))
        const rest = mode === "both" ? [] : initial.filter((g) => !fetchedKeys.has(g.value) && !toFetch.includes(g.value))
        setGroups([...fetchedGroups, ...rest].sort((a, b) => b.copies - a.copies || b.wasted - a.wasted))
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldDefs, mode, p.refreshToken])

  const facetField = mode === "filename" ? filenameField : checksumField
  const totalGroups = groups.length
  const totalRecords = groups.reduce((s, g) => s + g.copies, 0)
  const redundant = groups.reduce((s, g) => s + Math.max(0, g.copies - 1), 0)
  const fetchedGroups = groups.filter((g) => g.fetched)
  const wasted = fetchedGroups.reduce((s, g) => s + g.wasted, 0)
  const distribution = [
    { label: "2 copies", value: groups.filter((g) => g.copies === 2).length },
    { label: "3 copies", value: groups.filter((g) => g.copies === 3).length },
    { label: "4–5 copies", value: groups.filter((g) => g.copies >= 4 && g.copies <= 5).length },
    { label: "6+ copies", value: groups.filter((g) => g.copies >= 6).length },
  ]
  const maxWasted = Math.max(0, ...fetchedGroups.map((g) => g.wasted))

  if (fieldDefs && !checksumField && !filenameField) {
    return (
      <ReportCard title="Duplicates needs two fields in this environment">
        <div className="text-sm space-y-3 max-w-2xl">
          <p>
            Detection facets on a checksum of the master file. This environment has no field named <code className="font-mono text-xs bg-muted px-1 rounded">_Checksum</code> or{" "}
            <code className="font-mono text-xs bg-muted px-1 rounded">_Filename</code>.
          </p>
          <p className="text-muted-foreground">
            Create two global, indexed, single-line text fields with those names and populate them with rule references, resetting on master file change:
          </p>
          <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto">{`<!-- _Checksum -->\n<ref:record file="master" out="CRC32"/>\n\n<!-- _Filename -->\n<ref:record file="master" out="filename"/>`}</pre>
          <p className="text-muted-foreground">Existing assets need a resave or maintenance job to populate the fields before duplicates can be detected.</p>
        </div>
      </ReportCard>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          {(["checksum", "filename", "both"] as MatchMode[]).map((m) => {
            const disabled = (m !== "filename" && !checksumField) || (m !== "checksum" && !filenameField)
            return (
              <button
                key={m}
                onClick={() => !disabled && setMode(m)}
                disabled={disabled}
                className={`px-3 py-1.5 transition-colors disabled:opacity-40 ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                title={disabled ? "Field not found in this environment" : undefined}
              >
                {m === "checksum" ? "Same checksum" : m === "filename" ? "Same filename" : "Checksum and filename"}
              </button>
            )
          })}
        </div>
        {facetField && <span className="text-xs text-muted-foreground font-mono">faceting on {facetField.name}</span>}
        {EDITOR_TOOLS_URL && (
          <a href={`${EDITOR_TOOLS_URL}/duplicates`} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            Resolve in Editor Tools <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {error && <ReportCard title="Duplicates" error={error} />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Duplicate groups" value={loading ? null : totalGroups} hint={facetTruncated ? "facet truncated; lower bound" : "values shared by 2+ records"} icon={<Copy className="h-4 w-4" />} colorVar="--rl-2" loading={loading} />
        <KpiTile label="Records involved" value={loading ? null : totalRecords} icon={<Layers className="h-4 w-4" />} colorVar="--rl-5" loading={loading} />
        <KpiTile label="Redundant copies" value={loading ? null : redundant} hint="records beyond one per group" icon={<Files className="h-4 w-4" />} colorVar="--rl-2" loading={loading} />
        <KpiTile label="Storage in redundant copies" value={fetchedGroups.length ? wasted : null} format={(n) => (n == null ? "–" : formatBytes(n))} hint={fetchedGroups.length ? `across the ${fetchedGroups.length} largest groups` : "sizing…"} icon={<HardDrive className="h-4 w-4" />} colorVar="--rl-4" loading={loading} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <ReportCard title="Groups by copy count" className="xl:col-span-2" loading={loading}>
          {loading ? <LoadingBlock /> : <ColumnChart data={distribution} colorVar="--rl-2" height={200} />}
        </ReportCard>
        <ReportCard title="Largest duplicate groups" subtitle={`Top ${Math.min(MAX_GROUPS_FETCHED, totalGroups)} groups are sized from their master files`} className="xl:col-span-3" loading={loading}>
          <DataTable<Group>
            rows={groups}
            rowKey={(g) => g.key}
            initialRows={15}
            exportName="duplicate-groups"
            emptyMessage="No duplicates found. Every value in the facet is unique."
            columns={[
              { key: "records", header: "Records", render: (g) =>
                g.records.length ? (
                  <div className="flex flex-col gap-1">
                    {g.records.slice(0, 4).map((r) => (
                      <RecordCell key={r.id} card={r} fallbackId={r.id} environment={p.environment} />
                    ))}
                    {g.records.length > 4 && <span className="text-xs text-muted-foreground">+{g.records.length - 4} more</span>}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">not fetched (beyond top {MAX_GROUPS_FETCHED})</span>
                ),
                exportValue: (g) => g.records.map((r) => r.title).join(" | "),
              },
              { key: "value", header: mode === "filename" ? "Filename" : "Checksum", render: (g) => (
                <span className="font-mono text-xs break-all">{mode === "both" ? `${g.value} · ${g.fileName}` : g.value}</span>
              ) },
              { key: "copies", header: "Copies", align: "right", render: (g) => formatInt(g.copies) },
              { key: "wasted", header: "Redundant storage", align: "right", width: "200px", render: (g) =>
                g.fetched ? (
                  <div className="flex items-center gap-2 justify-end">
                    <span className="w-16 text-right tabular-nums">{formatBytes(g.wasted)}</span>
                    <div className="w-20"><ShareBar value={g.wasted} max={maxWasted} colorVar="--rl-4" /></div>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">–</span>
                ),
                exportValue: (g) => (g.fetched ? g.wasted : ""),
              },
            ]}
          />
        </ReportCard>
      </div>
    </div>
  )
}
