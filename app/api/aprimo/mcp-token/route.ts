import { NextRequest, NextResponse } from "next/server"

// Token exchange and refresh for the Aprimo MCP consent flow (scope "mcp").
// The secret is chosen per registration: the deployment's own (server-side)
// for the default environment, APRIMO_MCP_CLIENT_SECRET_<ENV> when an admin
// preconfigured one, else the secret from the user's browser profile. Grants:
//   { grant: "code", environment, clientId, clientSecret?, code, codeVerifier, redirectUri }
//   { grant: "refresh", environment, clientId, clientSecret?, refreshToken }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { grant, environment, clientId } = body
    if (!environment || !clientId || !grant) return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    if (!/^[a-z0-9-]+$/i.test(environment)) return NextResponse.json({ error: "Invalid environment" }, { status: 400 })
    const isDefault = String(environment).toLowerCase() === (process.env.NEXT_PUBLIC_APRIMO_ENVIRONMENT ?? "").toLowerCase() && clientId === process.env.NEXT_PUBLIC_APRIMO_MCP_CLIENT_ID?.trim()
    const perEnv = process.env[`APRIMO_MCP_CLIENT_SECRET_${String(environment).toUpperCase().replace(/-/g, "_")}`]
    const clientSecret: string | undefined = (isDefault ? process.env.APRIMO_MCP_CLIENT_SECRET : undefined) || perEnv || (typeof body.clientSecret === "string" && body.clientSecret) || undefined
    if (!clientSecret) return NextResponse.json({ error: `No MCP client secret for ${environment}. Add it to the environment's connection profile.` }, { status: 503 })

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
