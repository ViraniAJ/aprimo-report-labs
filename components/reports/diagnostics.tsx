"use client"

import { useEffect, useState } from "react"
import { useReportParams } from "@/components/report-labs/report-context"
import { ReportCard, LoadingBlock } from "@/components/report-labs/ui"
import { queryAnalytics, str, toGuid, analyticsId, TITLE_DIM, TYPE_DIM } from "@/lib/analytics"
import { cardExpander } from "@/lib/core"
import { Button } from "@/components/ui/button"
import { MCP_CONFIGURED, readMcpTokens, getMcpToken, startMcpConsent, clearMcpTokens } from "@/lib/mcp-auth"

// Shows what the APIs actually return for a handful of records, so preview and
// lookup problems can be diagnosed on screen instead of guessed at.

interface Probe {
  source: string
  rawId: string
  guid: string
  ok: boolean
  errorType?: string
  errorMessage?: string
  title?: string
  contentType?: string
  embeddedKeys: string[]
  fileVersionKeys: string[]
  fileVersionEmbeddedKeys: string[]
  fileName?: string
  thumbnailUri?: string
  previewUri?: string
}

function host(u?: string): string {
  if (!u) return "–"
  try {
    return new URL(u).host
  } catch {
    return u.slice(0, 40)
  }
}

function ImageTest({ uri, label }: { uri?: string; label: string }) {
  const [state, setState] = useState<"none" | "loading" | "ok" | "failed">(uri ? "loading" : "none")
  if (!uri) return <span className="text-muted-foreground">{label}: none</span>
  return (
    <span className="inline-flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={uri} alt="" className="h-8 w-8 rounded object-cover bg-muted" onLoad={() => setState("ok")} onError={() => setState("failed")} />
      <span>
        {label}: <b className={state === "failed" ? "text-destructive" : state === "ok" ? "text-success" : ""}>{state}</b>{" "}
        <span className="text-muted-foreground">({host(uri)})</span>
      </span>
    </span>
  )
}

export function Diagnostics() {
  const p = useReportParams()
  const [loading, setLoading] = useState(true)
  const [probes, setProbes] = useState<Probe[]>([])
  const [note, setNote] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    async function probe(source: string, rawId: string): Promise<Probe> {
      const guid = toGuid(rawId)
      const res = await p.client.records.getById(guid, cardExpander() as never)
      if (!res.ok) {
        const err = res.error as { name?: string; message?: string; constructor?: { name?: string } }
        return { source, rawId, guid, ok: false, errorType: err?.constructor?.name ?? err?.name, errorMessage: err?.message, embeddedKeys: [], fileVersionKeys: [], fileVersionEmbeddedKeys: [] }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = res.data as any
      const mflv = rec._embedded?.masterfilelatestversion
      return {
        source,
        rawId,
        guid,
        ok: true,
        title: rec.title,
        contentType: rec.contentType,
        embeddedKeys: Object.keys(rec._embedded ?? {}),
        fileVersionKeys: mflv ? Object.keys(mflv).filter((k) => k !== "_embedded" && k !== "_links") : [],
        fileVersionEmbeddedKeys: Object.keys(mflv?._embedded ?? {}),
        fileName: mflv?.fileName,
        thumbnailUri: mflv?._embedded?.thumbnail?.uri,
        previewUri: mflv?._embedded?.preview?.uri,
      }
    }
    async function load() {
      const notes: string[] = []
      const out: Probe[] = []
      try {
        // 1. Ids as analytics returns them, with and without a time dimension
        const end = new Date().toISOString().slice(0, 10)
        const start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
        const [noTime, withTime, total] = await Promise.all([
          queryAnalytics(p.environment, p.authHeader, { measures: ["Views.count"], dimensions: ["Views.recordId"], order: { "Views.count": "desc" }, limit: 3 }).catch((e) => ({ error: String(e) })),
          queryAnalytics(p.environment, p.authHeader, { measures: ["Views.count"], dimensions: ["Views.recordId"], timeDimensions: [{ dimension: "DateDimension.date", dateRange: [start, end] }], order: { "Views.count": "desc" }, limit: 3 }).catch((e) => ({ error: String(e) })),
          queryAnalytics(p.environment, p.authHeader, { measures: ["Views.count"] }).catch((e) => ({ error: String(e) })),
        ])
        notes.push(`Views.count total, no time dimension: ${Array.isArray(total) ? JSON.stringify(total[0] ?? {}) : total.error}`)
        notes.push(`Top viewed, no time dimension: ${Array.isArray(noTime) ? `${noTime.length} rows` : noTime.error}`)
        notes.push(`Top viewed, last 365 days: ${Array.isArray(withTime) ? `${withTime.length} rows` : withTime.error}`)
        const rows = Array.isArray(withTime) && withTime.length ? withTime : Array.isArray(noTime) ? noTime : []
        const ids = rows.map((r) => str(r["Views.recordId"])).filter(Boolean)
        notes.push(`Sample analytics id: ${ids[0] ?? "none"} (length ${ids[0]?.length ?? 0}, lowercase match: ${ids[0] ? String(ids[0] === analyticsId(ids[0])) : "n/a"})`)
        for (const id of ids) out.push(await probe("analytics top viewed", id))
      } catch (e) {
        notes.push(`Analytics query failed: ${e instanceof Error ? e.message : String(e)}`)
      }
      try {
        // 2. Recent records with a file, straight from search with the same expander
        const res = await p.client.search.records({ searchExpression: { expression: "FileCount > 0" }, page: 1, pageSize: 3 } as never, cardExpander() as never)
        if (res.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const items = ((res.data as unknown as { items?: any[] }).items ?? []) as any[]
          notes.push(`Search returned ${items.length} records with files.`)
          // 3. Does getById accept the dashed GUID and the plain 32-char form?
          if (items[0]?.id) {
            const plain = String(items[0].id).replace(/-/g, "")
            const dashed = toGuid(plain)
            const [a, b] = await Promise.all([p.client.records.getById(dashed), p.client.records.getById(plain)])
            const describe = (r: { ok: boolean; error?: unknown }) => (r.ok ? "ok" : `failed (${(r.error as { constructor?: { name?: string } })?.constructor?.name ?? "error"})`)
            notes.push(`getById with dashed id: ${describe(a)} · with plain id: ${describe(b)}`)
          }
          for (const it of items) {
            const mflv = it._embedded?.masterfilelatestversion
            out.push({
              source: "search FileCount > 0",
              rawId: it.id,
              guid: it.id,
              ok: true,
              title: it.title,
              contentType: it.contentType,
              embeddedKeys: Object.keys(it._embedded ?? {}),
              fileVersionKeys: mflv ? Object.keys(mflv).filter((k) => k !== "_embedded" && k !== "_links") : [],
              fileVersionEmbeddedKeys: Object.keys(mflv?._embedded ?? {}),
              fileName: mflv?.fileName,
              thumbnailUri: mflv?._embedded?.thumbnail?.uri,
              previewUri: mflv?._embedded?.preview?.uri,
            })
          }
        } else notes.push(`Search failed: ${(res as { error?: { message?: string } }).error?.message}`)
      } catch (e) {
        notes.push(`Search threw: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (!cancelled) {
        setProbes(out)
        setNote(notes)
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [p.client, p.environment, p.authHeader, p.refreshToken])

  return (
    <div className="flex flex-col gap-4">
      <TitleJoinCheck />
      <McpBridgeCheck />
      <ReportCard title="What the APIs return" subtitle="Three top-viewed records via analytics id lookup, and three recent records with files via search">
        {loading ? (
          <LoadingBlock />
        ) : (
          <div className="flex flex-col gap-3 text-xs">
            <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
              {note.map((n, i) => (
                <li key={i} className="font-mono break-all">{n}</li>
              ))}
            </ul>
            {probes.map((pr, i) => (
              <div key={i} className="rounded-md border border-border p-3 grid gap-1 font-mono break-all">
                <div className="text-muted-foreground">{pr.source}</div>
                <div>id: {pr.rawId} → {pr.guid}</div>
                {!pr.ok ? (
                  <div className="text-destructive">lookup failed: {pr.errorType} {pr.errorMessage}</div>
                ) : (
                  <>
                    <div>title: {pr.title ?? "(none)"} · type: {pr.contentType ?? "(none)"}</div>
                    <div>record _embedded: [{pr.embeddedKeys.join(", ") || "empty"}]</div>
                    <div>file version keys: [{pr.fileVersionKeys.slice(0, 12).join(", ") || "no master file version"}]</div>
                    <div>file version _embedded: [{pr.fileVersionEmbeddedKeys.join(", ") || "empty"}]</div>
                    <div>fileName: {pr.fileName ?? "(none)"}</div>
                    <div className="flex flex-wrap gap-4 font-sans">
                      <ImageTest uri={pr.thumbnailUri} label="thumbnail" />
                      <ImageTest uri={pr.previewUri} label="preview" />
                    </div>
                    {pr.thumbnailUri && <div className="text-muted-foreground">thumbnail url: {pr.thumbnailUri.slice(0, 160)}{pr.thumbnailUri.length > 160 ? "…" : ""}</div>}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </ReportCard>
    </div>
  )
}


interface McpCheck {
  server?: { name?: string; version?: string }
  totalTools?: number
  allowedTools?: string[]
  missingFromServer?: string[]
  sample?: { isError: boolean; preview: string }
  ms?: number
  error?: string
}

/** Proves the MCP bridge end to end without the model: consent, token, server, allowlist, one call. */
function McpBridgeCheck() {
  const p = useReportParams()
  const [enabled, setEnabled] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<McpCheck | null>(null)

  useEffect(() => {
    const refresh = () => setEnabled(!!readMcpTokens(p.environment))
    refresh()
    window.addEventListener("aprimo:mcp-changed", refresh)
    return () => window.removeEventListener("aprimo:mcp-changed", refresh)
  }, [p.environment])

  const run = async () => {
    setRunning(true)
    setResult(null)
    try {
      const token = await getMcpToken(p.environment)
      if (!token) {
        setResult({ error: "No MCP token. Enable Aprimo tools first." })
        return
      }
      const res = await fetch("/api/aprimo/mcp-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment: p.environment, token }) })
      setResult(await res.json())
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <ReportCard
      title="Aprimo MCP bridge"
      subtitle={MCP_CONFIGURED ? "Second consent (scope mcp), server-side bridge, and the read-only tool allowlist" : "Not configured: set NEXT_PUBLIC_APRIMO_MCP_CLIENT_ID and APRIMO_MCP_CLIENT_SECRET"}
      actions={
        MCP_CONFIGURED ? (
          <div className="flex items-center gap-2">
            {enabled ? (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={run} disabled={running}>{running ? "Checking…" : "Run check"}</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearMcpTokens}>Disable</Button>
              </>
            ) : (
              <Button size="sm" className="h-7 text-xs" onClick={() => startMcpConsent(p.environment)}>Enable Aprimo tools</Button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="text-xs font-mono break-all flex flex-col gap-1">
        <div>consent: {enabled ? "granted (token stored in this browser)" : "not granted"}</div>
        {result?.error && <div className="text-destructive">error: {result.error}</div>}
        {result && !result.error && (
          <>
            <div>server: {result.server?.name} {result.server?.version} · {result.totalTools} tools exposed · {result.ms} ms</div>
            <div>allowlisted and available ({result.allowedTools?.length}): {result.allowedTools?.join(", ")}</div>
            {result.missingFromServer && result.missingFromServer.length > 0 && <div className="text-muted-foreground">allowlisted but not on server: {result.missingFromServer.join(", ")}</div>}
            <div>sample list_records (3 most recently modified){result.sample?.isError ? " · ERROR" : ""}:</div>
            <pre className="whitespace-pre-wrap bg-muted rounded p-2 max-h-64 overflow-auto">{result.sample?.preview}</pre>
          </>
        )}
      </div>
    </ReportCard>
  )
}


// ── Title join: does RecordMetadata.title / Records.contentType join onto each cube? ──

const JOIN_CUBES: Array<{ cube: string; measure: string; recordDim: string; timeDim: string }> = [
  { cube: "Views", measure: "Views.count", recordDim: "Views.recordId", timeDim: "DateDimension.date" },
  { cube: "Downloads", measure: "Downloads.count", recordDim: "Downloads.recordId", timeDim: "Downloads.downloadDate" },
  { cube: "Impressions", measure: "Impressions.count", recordDim: "Impressions.recordId", timeDim: "Impressions.hitDateTime" },
  { cube: "PreviewPlaybacks", measure: "PreviewPlaybacks.count", recordDim: "PreviewPlaybacks.recordId", timeDim: "PreviewPlaybacks.previewPlaybackDate" },
]

function TitleJoinCheck() {
  const p = useReportParams()
  const [rows, setRows] = useState<Array<{ cube: string; status: string; sample: string; ms: number }> | null>(null)
  useEffect(() => {
    let cancelled = false
    const end = new Date().toISOString().slice(0, 10)
    const start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
    Promise.all(
      JOIN_CUBES.map(async (c) => {
        const started = Date.now()
        try {
          const r = await queryAnalytics(p.environment, p.authHeader, {
            measures: [c.measure],
            dimensions: [c.recordDim, TITLE_DIM, TYPE_DIM],
            timeDimensions: [{ dimension: c.timeDim, dateRange: [start, end] }],
            order: { [c.measure]: "desc" },
            limit: 3,
          })
          const withTitle = r.filter((x) => str(x[TITLE_DIM]).trim()).length
          const sample = r.slice(0, 2).map((x) => `${str(x[TITLE_DIM]) || "(no title)"} · ${str(x[TYPE_DIM]) || "(no type)"}`).join(" | ")
          return { cube: c.cube, status: r.length ? `join OK · ${withTitle}/${r.length} rows have a title` : "join accepted, no rows in last 365 days", sample, ms: Date.now() - started }
        } catch (e) {
          return { cube: c.cube, status: `join REJECTED: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`, sample: "", ms: Date.now() - started }
        }
      }),
    ).then((r) => !cancelled && setRows(r))
    return () => {
      cancelled = true
    }
  }, [p.environment, p.authHeader, p.refreshToken])

  return (
    <ReportCard title="Title join" subtitle="Whether RecordMetadata.title and Records.contentType can be joined onto each engagement cube. When they can, rankings need no per-record lookups.">
      {!rows ? (
        <LoadingBlock height={80} />
      ) : (
        <div className="text-xs font-mono break-all flex flex-col gap-1">
          {rows.map((r) => (
            <div key={r.cube}>
              <span className="font-semibold">{r.cube}</span>: <span className={r.status.startsWith("join REJECTED") ? "text-destructive" : ""}>{r.status}</span> <span className="text-muted-foreground">({r.ms} ms)</span>
              {r.sample && <div className="text-muted-foreground pl-4">{r.sample}</div>}
            </div>
          ))}
        </div>
      )}
    </ReportCard>
  )
}
