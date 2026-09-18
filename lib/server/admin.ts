import { identify, IdentityError, type AprimoIdentity } from "@/lib/server/identity"

// Admin access for the intelligence page. Admins are named by Aprimo login in
// REPORT_LABS_ADMINS (comma-separated, case-insensitive). The caller's token
// is verified the same way as every other route, so the list is the only
// thing that separates an admin from any other signed-in user.

export class AdminError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export function adminLogins(): string[] {
  return (process.env.REPORT_LABS_ADMINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdmin(who: AprimoIdentity): boolean {
  const admins = adminLogins()
  return admins.includes(who.login.toLowerCase()) || admins.includes(who.userId.toLowerCase())
}

export async function requireAdmin(environment: string | undefined, token: string | undefined): Promise<AprimoIdentity> {
  if (!environment || !token) throw new AdminError("Missing environment or token", 400)
  let who: AprimoIdentity
  try {
    who = await identify(environment, token)
  } catch (e) {
    throw new AdminError(e instanceof IdentityError ? e.message : "Could not verify token", 401)
  }
  if (!adminLogins().length) throw new AdminError("No admins are configured on this deployment (REPORT_LABS_ADMINS).", 403)
  if (!isAdmin(who)) throw new AdminError("Your Aprimo login is not on the admin list for this deployment.", 403)
  return who
}
