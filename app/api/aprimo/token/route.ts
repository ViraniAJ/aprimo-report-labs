import { NextRequest, NextResponse } from "next/server"

// Exchanges a PKCE authorization code for an Aprimo access token.
// The client secret never needs to reach the browser: when APRIMO_CLIENT_SECRET
// is set on the server it is used here, and the browser only sends the
// environment and client id. A secret supplied by the browser (saved profile)
// is honoured as a fallback for self-managed connections.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { environment, clientId, code, codeVerifier, redirectUri } = body
    const clientSecret: string | undefined = process.env.APRIMO_CLIENT_SECRET || body.clientSecret || undefined

    if (!environment || !clientId || !code || !codeVerifier || !redirectUri) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    if (!/^[a-z0-9-]+$/i.test(environment)) {
      return NextResponse.json({ error: "Invalid environment" }, { status: 400 })
    }

    const params = new URLSearchParams()
    params.append("grant_type", "authorization_code")
    params.append("client_id", clientId)
    params.append("code", code)
    params.append("code_verifier", codeVerifier)
    params.append("redirect_uri", redirectUri)
    if (clientSecret) params.append("client_secret", clientSecret)

    const response = await fetch(`https://${environment}.aprimo.com/login/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
    const data = await response.json()
    if (!response.ok) {
      console.error("[aprimo] Token error:", response.status, data)
      return NextResponse.json({ error: data.error_description || data.error || "Token request failed" }, { status: response.status })
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error("[aprimo] Token route error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
