import { NextRequest, NextResponse } from "next/server"

// Token exchange and refresh for the Aprimo MCP consent flow (scope "mcp").
// The MCP registration is confidential, so its secret lives here and never
// reaches the browser. Two grants:
//   { grant: "code", environment, clientId, code, codeVerifier, redirectUri }
//   { grant: "refresh", environment, clientId, refreshToken }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { grant, environment, clientId } = body
    if (!environment || !clientId || !grant) return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    if (!/^[a-z0-9-]+$/i.test(environment)) return NextResponse.json({ error: "Invalid environment" }, { status: 400 })
    // The MCP registration is per environment; APRIMO_MCP_CLIENT_SECRET_<ENV> overrides the default.
    const clientSecret = process.env[`APRIMO_MCP_CLIENT_SECRET_${String(environment).toUpperCase().replace(/-/g, "_")}`] || process.env.APRIMO_MCP_CLIENT_SECRET
    if (!clientSecret) return NextResponse.json({ error: "APRIMO_MCP_CLIENT_SECRET is not configured on the server" }, { status: 503 })

    const params = new URLSearchParams()
    params.append("client_id", clientId)
    params.append("client_secret", clientSecret)
    if (grant === "code") {
      const { code, codeVerifier, redirectUri } = body
      if (!code || !codeVerifier || !redirectUri) return NextResponse.json({ error: "Missing code, verifier, or redirect URI" }, { status: 400 })
      params.append("grant_type", "authorization_code")
      params.append("code", code)
      params.append("code_verifier", codeVerifier)
      params.append("redirect_uri", redirectUri)
    } else if (grant === "refresh") {
      if (!body.refreshToken) return NextResponse.json({ error: "Missing refresh token" }, { status: 400 })
      params.append("grant_type", "refresh_token")
      params.append("refresh_token", body.refreshToken)
    } else {
      return NextResponse.json({ error: "Unknown grant" }, { status: 400 })
    }

    const response = await fetch(`https://${environment}.aprimo.com/login/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
    const data = await response.json()
    if (!response.ok) {
      console.error("[aprimo mcp] Token error:", response.status, data)
      return NextResponse.json({ error: data.error_description || data.error || "Token request failed" }, { status: response.status })
    }
    return NextResponse.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      scope: data.scope,
    })
  } catch (error) {
    console.error("[aprimo mcp] Token route error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
