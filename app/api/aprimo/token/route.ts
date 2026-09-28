import { NextRequest, NextResponse } from "next/server"

// Exchanges a PKCE authorization code for an Aprimo access token.
// The secret is chosen per environment so the browser never needs to hold
// one for the deployment's own environment:
//   1. APRIMO_CLIENT_SECRET for the default environment and client id
//   2. APRIMO_CLIENT_SECRET_<ENV> (upper-case, dashes as underscores) for any
//      other environment an admin has configured server-side
//   3. otherwise the secret saved in the user's browser profile
function secretFor(environment: string, clientId: string, fromBrowser?: string): string | undefined {
  const isDefault = environment.toLowerCase() === (process.env.NEXT_PUBLIC_APRIMO_ENVIRONMENT ?? "").toLowerCase() && clientId === process.env.NEXT_PUBLIC_APRIMO_CLIENT_ID
  const perEnv = process.env[`APRIMO_CLIENT_SECRET_${environment.toUpperCase().replace(/-/g, "_")}`]
  return (isDefault ? process.env.APRIMO_CLIENT_SECRET : undefined) || perEnv || fromBrowser || undefined
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { environment, clientId, code, codeVerifier, redirectUri } = body
    const clientSecret = typeof environment === "string" && typeof clientId === "string" ? secretFor(environment, clientId, body.clientSecret) : undefined

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
