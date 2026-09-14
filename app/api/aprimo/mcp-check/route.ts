import { NextRequest, NextResponse } from "next/server"
import { McpClient, MCP_ALLOWLIST } from "@/lib/mcp"

// Verifies the MCP bridge end to end without involving the model: connects
// with the user's mcp token, lists which allowlisted tools the server offers,
// and runs one cheap listing. Used by the Diagnostics report.
export async function POST(request: NextRequest) {
  try {
    const { environment, token } = await request.json()
    if (!environment || !token) return NextResponse.json({ error: "Missing environment or token" }, { status: 400 })
    if (!/^[a-z0-9-]+$/i.test(environment)) return NextResponse.json({ error: "Invalid environment" }, { status: 400 })

    const client = new McpClient(environment, token)
    const started = Date.now()
    const server = await client.initialize()
    const all = await client.listTools()
    const allowed = await client.listAllowedTools()
    const missing = MCP_ALLOWLIST.filter((n) => !all.some((t) => t.name === n))
    const sample = await client.callTool("list_records", { sort: "ModifiedOn desc", take: 3 })
    return NextResponse.json({
      server,
      totalTools: all.length,
      allowedTools: allowed.map((t) => t.name),
      missingFromServer: missing,
      sample: { isError: sample.isError, preview: sample.text.slice(0, 2000) },
      ms: Date.now() - started,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const status = /MCP 401/.test(message) ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
