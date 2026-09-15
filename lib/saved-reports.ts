"use client"

import type { ReportSpec } from "@/lib/report-spec"

export interface SavedReportSummary {
  id: string
  title: string
  description: string | null
  view: "html" | "standard"
  source: string
  pinned: boolean
  created_at: string
  updated_at: string
}

export interface SavedReport extends SavedReportSummary {
  spec: ReportSpec
  html: string | null
}

export class SavedReportsUnavailable extends Error {}

async function call<T>(environment: string, token: string, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/saved-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment, token, action, ...extra }) })
  if (res.status === 503) throw new SavedReportsUnavailable("Saved reports are not configured on this deployment")
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`)
  return data as T
}

export const savedReports = {
  list: (env: string, token: string) => call<{ items: SavedReportSummary[] }>(env, token, "list").then((r) => r.items),
  get: (env: string, token: string, id: string) => call<{ item: SavedReport }>(env, token, "get", { id }).then((r) => r.item),
  save: (env: string, token: string, r: { id?: string; title: string; description?: string; view: "html" | "standard"; spec: ReportSpec; html?: string; source?: string }) =>
    call<{ item: SavedReportSummary }>(env, token, "save", r).then((x) => x.item),
  pin: (env: string, token: string, id: string, pinned: boolean) => call<{ item: SavedReportSummary }>(env, token, "pin", { id, pinned }).then((r) => r.item),
  remove: (env: string, token: string, id: string) => call<{ ok: true }>(env, token, "delete", { id }),
}
