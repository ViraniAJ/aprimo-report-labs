// Server-side client for the Aprimo MCP server (Streamable HTTP, JSON-RPC).
// Used by the assistant to expose a read-only allowlist of Aprimo tools, and by
// the Diagnostics check. Every call carries the signed-in user's "mcp" token.

export interface McpToolDef {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpCallResult {
  isError: boolean
  text: string
  structured?: unknown
}

/**
 * Read-only tools the assistant may use. The server exposes ~200 including
 * many writes; only these are ever registered with the model.
 */
export const MCP_ALLOWLIST: string[] = [
  // Records
  "search_aprimo",
  "list_records",
  "get_record_metadata",
  "get_record_thumbnail_url",
  "get_record_preview_url",
  "list_record_classifications",
  "get_record_duplicate_info",
  // Collections
  "list_collections",
  "search_collections",
  "get_collection_records",
  // Classifications
  "browse_classifications",
  "search_classifications",
  "get_classification",
  "list_classification_children",
  // Field definitions
  "list_field_definitions",
  "get_custom_field_definition",
  "get_field_definition_list_values",
  // Marketing operations (read)
  "search_activities",
  "search_projects",
  "get_project",
  "get_project_tasks",
  "search_tasks",
  "list_work_requests",
]

/** Extra guidance appended to selected tool descriptions to keep results small. */
const DESCRIPTION_NOTES: Record<string, string> = {
  search_aprimo: "Results are large: always pass includeFields with only the field names you need (an empty list for none), and keep limit at 10 or below.",
  get_record_metadata: "Pass includeFields with only the custom fields you need; an empty list returns system properties and file info only.",
  list_records: "Cheapest way to list by DAM query syntax with sort, e.g. filter=\"ModifiedOn > '09/01/2026'\", sort=\"ModifiedOn desc\", take=10. Returns title, status, type, dates and a deep link.",
}

const MAX_RESULT_CHARS = 12_000

export class McpClient {
  private sessionId: string | undefined
  private nextId = 1
  constructor(
    private environment: string,
    private token: string,
  ) {}

  get url(): string {
    return `https://${this.environment}.aprimo.com/mcp`
  }

  private async rpc(method: string, params: unknown): Promise<{ result?: unknown; error?: { code?: number; message?: string } }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    }
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId
    const res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }) })
    const sid = res.headers.get("mcp-session-id")
    if (sid) this.sessionId = sid
    const raw = await res.text()
    if (!res.ok) throw new Error(`MCP ${res.status}: ${raw.slice(0, 300)}`)
    const trimmed = raw.trimStart()
    if (trimmed.startsWith("{")) return JSON.parse(trimmed)
    const messages = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => JSON.parse(l.slice(5)))
    return messages[messages.length - 1] ?? {}
  }

  async initialize(): Promise<{ name?: string; version?: string }> {
    const r = await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "report-labs", version: "1.0" } })
    if (r.error) throw new Error(r.error.message ?? "MCP initialize failed")
    return ((r.result as { serverInfo?: { name?: string; version?: string } })?.serverInfo) ?? {}
  }

  async listTools(): Promise<McpToolDef[]> {
    const out: McpToolDef[] = []
    let cursor: string | undefined
    do {
      const r = await this.rpc("tools/list", cursor ? { cursor } : {})
      if (r.error) throw new Error(r.error.message ?? "MCP tools/list failed")
      const res = r.result as { tools?: McpToolDef[]; nextCursor?: string }
      out.push(...(res.tools ?? []))
      cursor = res.nextCursor
    } while (cursor)
    return out
  }

  /** Only the allowlisted tools, in allowlist order, with sizing notes appended. */
  async listAllowedTools(): Promise<McpToolDef[]> {
    const all = await this.listTools()
    const byName = new Map(all.map((t) => [t.name, t]))
    return MCP_ALLOWLIST.filter((n) => byName.has(n)).map((n) => {
      const t = byName.get(n)!
      const note = DESCRIPTION_NOTES[n]
      return { ...t, description: [t.description ?? "", note].filter(Boolean).join(" ") }
    })
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (!MCP_ALLOWLIST.includes(name)) throw new Error(`Tool "${name}" is not on the read-only allowlist`)
    const r = await this.rpc("tools/call", { name, arguments: args })
    if (r.error) throw new Error(r.error.message ?? `MCP call to ${name} failed`)
    const res = r.result as { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown; isError?: boolean }
    const structured = res.structuredContent
    let text = structured !== undefined ? JSON.stringify(structured) : (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n")
    if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS) + `\n…[truncated at ${MAX_RESULT_CHARS} characters; narrow the query or pass includeFields]`
    return { isError: !!res.isError, text, structured }
  }
}
