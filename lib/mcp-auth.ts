"use client"

// Browser-side handling of the second Aprimo consent: scope "mcp" for the
// Aprimo MCP server. Separate from the "api" login because Aprimo binds scopes
// to registration types and will not issue both on one token.

import { generatePKCE } from "@/lib/pkce"

export const MCP_CLIENT_ID = process.env.NEXT_PUBLIC_APRIMO_MCP_CLIENT_ID?.trim() || ""
export const MCP_CONFIGURED = !!MCP_CLIENT_ID

const KEY = "report_labs_mcp"
const PENDING = "report_labs_mcp_pending"

export interface McpTokens {
  environment: string
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

export function mcpCallbackUri(): string {
  return `${window.location.origin}/oauth/mcp-callback`
}

export function readMcpTokens(environment: string): McpTokens | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as McpTokens
    return t.environment === environment ? t : null
  } catch {
    return null
  }
}

export function writeMcpTokens(t: McpTokens) {
  localStorage.setItem(KEY, JSON.stringify(t))
  window.dispatchEvent(new Event("aprimo:mcp-changed"))
}

export function clearMcpTokens() {
  localStorage.removeItem(KEY)
  window.dispatchEvent(new Event("aprimo:mcp-changed"))
}

/** Starts the consent flow; the browser navigates away and returns via /oauth/mcp-callback. */
export async function startMcpConsent(environment: string) {
  if (!MCP_CLIENT_ID) throw new Error("NEXT_PUBLIC_APRIMO_MCP_CLIENT_ID is not set")
  const { codeVerifier, codeChallenge } = await generatePKCE()
  const state = crypto.randomUUID()
  sessionStorage.setItem(PENDING, JSON.stringify({ environment, codeVerifier, state, returnUrl: window.location.href }))
  const params = new URLSearchParams({
    response_type: "code",
    client_id: MCP_CLIENT_ID,
    redirect_uri: mcpCallbackUri(),
    scope: "mcp offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    resource: `https://${environment}.aprimo.com/mcp`,
  })
  window.location.href = `https://${environment}.aprimo.com/login/connect/authorize?${params.toString()}`
}

export function readPendingConsent(): { environment: string; codeVerifier: string; state: string; returnUrl: string } | null {
  try {
    const raw = sessionStorage.getItem(PENDING)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearPendingConsent() {
  sessionStorage.removeItem(PENDING)
}

async function exchange(body: Record<string, unknown>) {
  const res = await fetch("/api/aprimo/mcp-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || "MCP token request failed")
  return data as { access_token: string; refresh_token?: string; expires_in: number }
}

export async function completeMcpConsent(code: string, state: string): Promise<McpTokens> {
  const pending = readPendingConsent()
  if (!pending) throw new Error("No consent in progress")
  if (pending.state !== state) throw new Error("State mismatch")
  const data = await exchange({ grant: "code", environment: pending.environment, clientId: MCP_CLIENT_ID, code, codeVerifier: pending.codeVerifier, redirectUri: mcpCallbackUri() })
  const tokens: McpTokens = {
    environment: pending.environment,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  writeMcpTokens(tokens)
  clearPendingConsent()
  return tokens
}

/**
 * Returns a valid MCP access token for the environment, refreshing it when it
 * is within two minutes of expiry. Returns null when the user has not consented
 * or the refresh fails (in which case stored tokens are cleared).
 */
export async function getMcpToken(environment: string): Promise<string | null> {
  const t = readMcpTokens(environment)
  if (!t) return null
  if (Date.now() < t.expiresAt - 120_000) return t.accessToken
  if (!t.refreshToken) {
    clearMcpTokens()
    return null
  }
  try {
    const data = await exchange({ grant: "refresh", environment, clientId: MCP_CLIENT_ID, refreshToken: t.refreshToken })
    const next: McpTokens = { environment, accessToken: data.access_token, refreshToken: data.refresh_token ?? t.refreshToken, expiresAt: Date.now() + data.expires_in * 1000 }
    writeMcpTokens(next)
    return next.accessToken
  } catch {
    clearMcpTokens()
    return null
  }
}
