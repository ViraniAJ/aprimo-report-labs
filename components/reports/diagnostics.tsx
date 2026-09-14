"use client"

import { useEffect, useState } from "react"
import { useReportParams } from "@/components/report-labs/report-context"
import { ReportCard, LoadingBlock } from "@/components/report-labs/ui"
import { queryAnalytics, str, toGuid, analyticsId } from "@/lib/analytics"
import { cardExpander } from "@/lib/core"

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
        // 1. Ids as analytics returns them
        const rows = await queryAnalytics(p.environment, p.authHeader, { measures: ["Views.count"], dimensions: ["Views.recordId"], order: { "Views.count": "desc" }, limit: 3 })
        const ids = rows.map((r) => str(r["Views.recordId"])).filter(Boolean)
        notes.push(`Analytics returned ${ids.length} record ids. Sample: ${ids[0] ?? "none"} (length ${ids[0]?.length ?? 0}, lowercase match: ${ids[0] ? String(ids[0] === analyticsId(ids[0])) : "n/a"})`)
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
