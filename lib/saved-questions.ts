"use client"

// Browser helper for the saved-questions API. The server verifies the Aprimo
// token and scopes every row to that user and environment.

export interface SavedQuestion {
  id: string
  question: string
  title: string | null
  report_id: string | null
  date_range: string | null
  pinned: boolean
  use_count: number
  last_used_at: string | null
  created_at: string
}

export class SavedQuestionsUnavailable extends Error {}

async function call<T>(environment: string, token: string, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/saved-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment, token, action, ...extra }),
  })
  if (res.status === 503) throw new SavedQuestionsUnavailable("Saved questions are not configured on this deployment")
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`)
  return data as T
}

export const savedQuestions = {
  list: (env: string, token: string) => call<{ items: SavedQuestion[] }>(env, token, "list").then((r) => r.items),
  save: (env: string, token: string, q: { question: string; title?: string; reportId?: string; dateRange?: string }) =>
    call<{ item: SavedQuestion; existed?: boolean }>(env, token, "save", q),
  touch: (env: string, token: string, id: string) => call<{ item: SavedQuestion }>(env, token, "touch", { id }).then((r) => r.item),
  pin: (env: string, token: string, id: string, pinned: boolean) => call<{ item: SavedQuestion }>(env, token, "pin", { id, pinned }).then((r) => r.item),
  remove: (env: string, token: string, id: string) => call<{ ok: true }>(env, token, "delete", { id }),
}
