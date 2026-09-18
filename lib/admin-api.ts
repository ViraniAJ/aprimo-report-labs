"use client"

import type { LogQuestion, SavedReportSummary, Insight } from "@/app/api/admin/route"

export type { LogQuestion, SavedReportSummary, Insight }

export interface AdminOverview {
  environment: string
  questions: LogQuestion[]
  savedReports: SavedReportSummary[]
  insight: Insight | null
  intents: Record<string, string>
  reports: Array<{ id: string; title: string; group: string }>
}

export class AdminForbidden extends Error {}

async function call<T>(environment: string, token: string, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment, token, action, ...extra }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 403) throw new AdminForbidden(data.message ?? "Forbidden")
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`)
  return data as T
}

export const adminApi = {
  whoami: (env: string, token: string) => call<{ admin: boolean; login?: string }>(env, token, "whoami"),
  overview: (env: string, token: string) => call<AdminOverview>(env, token, "overview"),
  insights: (env: string, token: string, windowDays: number) => call<{ insight: Insight }>(env, token, "insights", { windowDays }).then((r) => r.insight),
}
