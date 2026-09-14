import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// Server-only Supabase access with the service role. Nothing in the browser
// talks to Supabase; every table has RLS enabled with no policies, so only
// this key can read or write. Never import this from a client component.

let cached: SupabaseClient | null | undefined

export function serviceDb(): SupabaseClient | null {
  if (cached !== undefined) return cached
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  cached = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
  return cached
}

export interface SavedQuestionRow {
  id: string
  environment: string
  user_id: string
  user_login: string | null
  question: string
  title: string | null
  report_id: string | null
  date_range: string | null
  pinned: boolean
  use_count: number
  last_used_at: string | null
  created_at: string
}

export interface AssistantLogRow {
  environment: string
  user_id: string
  user_login: string | null
  question: string
  report_id: string | null
  date_range: string | null
  mcp_enabled: boolean
  tools: string[]
  answer_chars: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  duration_ms: number | null
  error: string | null
}
