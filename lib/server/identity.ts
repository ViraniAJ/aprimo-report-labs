import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

// Resolves who is calling from their Aprimo access token. Aprimo issues RS256
// JWTs and publishes its signing keys, so the token is verified locally
// against the environment's issuer. Identity comes from the DAM user claims;
// no extra Aprimo API call is needed.

export interface AprimoIdentity {
  environment: string
  /** DAM user GUID; stable across logins. */
  userId: string
  /** Login name, for display. */
  login: string
  /** Numeric subject from the token. */
  subject: string
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function keySetFor(issuer: string) {
  let set = keySets.get(issuer)
  if (!set) {
    set = createRemoteJWKSet(new URL(`${issuer}/.well-known/openid-configuration/jwks`), { cooldownDuration: 60_000 })
    keySets.set(issuer, set)
  }
  return set
}

export class IdentityError extends Error {}

export async function identify(environment: string, token: string): Promise<AprimoIdentity> {
  if (!/^[a-z0-9-]+$/i.test(environment)) throw new IdentityError("Invalid environment")
  const issuer = `https://${environment}.aprimo.com/login`
  let payload: JWTPayload
  try {
    ;({ payload } = await jwtVerify(token, keySetFor(issuer), { issuer }))
  } catch (e) {
    throw new IdentityError(`Token rejected: ${e instanceof Error ? e.message : String(e)}`)
  }
  const claims = payload as JWTPayload & Record<string, unknown>
  const userId = String(claims["dam-uid"] ?? claims["UID"] ?? claims.sub ?? "")
  if (!userId) throw new IdentityError("Token carries no user id")
  const login = String(claims["dam-login"] ?? claims["username"] ?? "")
  return { environment, userId: userId.toLowerCase(), login, subject: String(claims.sub ?? "") }
}
