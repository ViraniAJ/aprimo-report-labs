"use client"

// Connection profiles: one per Aprimo environment, kept in the browser. Each
// carries the PKCE registration used to sign in (scope "api") and, optionally,
// the MCP-type registration for that environment (scope "mcp"). The deployment's
// own environment comes from env vars and appears as a built-in profile.

export interface ConnectionProfile {
  id: string
  name: string
  environment: string
  clientId: string
  clientSecret: string
  /** MCP-type registration for this environment, for the assistant's Aprimo tools. */
  mcpClientId?: string
  mcpClientSecret?: string
  /** The deployment's default, from env vars. Cannot be edited or deleted. */
  builtIn?: boolean
}

export const ENV_ENVIRONMENT = process.env.NEXT_PUBLIC_APRIMO_ENVIRONMENT ?? ""
export const ENV_CLIENT_ID = process.env.NEXT_PUBLIC_APRIMO_CLIENT_ID ?? ""
export const ENV_MCP_CLIENT_ID = process.env.NEXT_PUBLIC_APRIMO_MCP_CLIENT_ID?.trim() || ""
export const ALL_FROM_ENV = !!(ENV_ENVIRONMENT && ENV_CLIENT_ID)

export const DEFAULT_PROFILE: ConnectionProfile | null = ALL_FROM_ENV
  ? { id: "default", name: `${ENV_ENVIRONMENT} (default)`, environment: ENV_ENVIRONMENT, clientId: ENV_CLIENT_ID, clientSecret: "", mcpClientId: ENV_MCP_CLIENT_ID || undefined, builtIn: true }
  : null

export const PROFILES_KEY = "report_labs_profiles"
export const LAST_PROFILE_KEY = "report_labs_last_profile_id"

export function loadProfiles(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    return raw ? (JSON.parse(raw) as ConnectionProfile[]) : []
  } catch {
    return []
  }
}

export function persistProfiles(profiles: ConnectionProfile[]) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles.filter((p) => !p.builtIn)))
}

/** Built-in default first, then the user's own. */
export function allProfiles(): ConnectionProfile[] {
  return DEFAULT_PROFILE ? [DEFAULT_PROFILE, ...loadProfiles()] : loadProfiles()
}

/** The profile "Connect" should use without asking: last used, else the default. */
export function lastUsedProfile(): ConnectionProfile | null {
  const all = allProfiles()
  const lastId = localStorage.getItem(LAST_PROFILE_KEY)
  return (lastId ? all.find((p) => p.id === lastId) : null) ?? DEFAULT_PROFILE ?? all[0] ?? null
}

export interface McpRegistration {
  clientId: string
  /** Present only for browser profiles; the default's secret lives on the server. */
  clientSecret?: string
  builtIn: boolean
}

/**
 * The MCP registration to use for an environment: the last-used profile for it
 * if that one names an MCP client id, else any profile for the environment that
 * does, else the deployment default when the environment matches.
 */
export function mcpRegistrationFor(environment: string): McpRegistration | null {
  const env = environment.toLowerCase()
  const candidates = allProfiles().filter((p) => p.environment.toLowerCase() === env && p.mcpClientId)
  const lastId = typeof localStorage !== "undefined" ? localStorage.getItem(LAST_PROFILE_KEY) : null
  const pick = candidates.find((p) => p.id === lastId) ?? candidates[0]
  if (!pick) return null
  return { clientId: pick.mcpClientId!, clientSecret: pick.builtIn ? undefined : pick.mcpClientSecret || undefined, builtIn: !!pick.builtIn }
}

/** Opens the connection picker (add or switch environments). */
export function openConnectionManager() {
  window.dispatchEvent(new CustomEvent("aprimo:open-config", { detail: { manage: true } }))
}
