"use client"

import { useState, useEffect, useRef } from "react"
import { useAprimo } from "@/context/aprimo-context"
import { generatePKCE, buildAuthorizationUrl } from "@/lib/pkce"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil, Trash2, Plus, ArrowLeft } from "lucide-react"
import { Badge } from "@/components/ui/badge"

// Connection handling for Report Labs.
//
// A deployment usually names a default environment (NEXT_PUBLIC_APRIMO_ENVIRONMENT
// and NEXT_PUBLIC_APRIMO_CLIENT_ID, secret server-side). That appears as a
// built-in profile. Users can add further environments as browser-side
// profiles (environment + client id of a PKCE registration whose redirect URI
// is this site's /oauth/callback, plus that registration's secret unless the
// server holds APRIMO_CLIENT_SECRET_<ENV>).
//
// "Connect" goes straight to the last-used profile; the gear, the environment
// pill, and "Other environment" open this dialog to switch or manage.

import { type ConnectionProfile, DEFAULT_PROFILE, ENV_ENVIRONMENT, LAST_PROFILE_KEY, loadProfiles, persistProfiles, allProfiles, lastUsedProfile } from "@/lib/profiles"

function startOAuth(environment: string, clientId: string, clientSecret?: string) {
  generatePKCE().then(({ codeVerifier, codeChallenge }) => {
    const redirectUri = `${window.location.origin}/oauth/callback`
    sessionStorage.setItem("pkce_environment", environment)
    sessionStorage.setItem("pkce_client_id", clientId)
    if (clientSecret) sessionStorage.setItem("pkce_client_secret", clientSecret)
    else sessionStorage.removeItem("pkce_client_secret")
    sessionStorage.setItem("pkce_code_verifier", codeVerifier)
    sessionStorage.setItem("pkce_return_url", window.location.href)
    window.location.href = buildAuthorizationUrl(environment, clientId, codeChallenge, redirectUri)
  })
}

type View = "list" | "edit"

export function AprimoConfigDialog() {
  const { isConnected } = useAprimo()
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [view, setView] = useState<View>("list")
  const [editing, setEditing] = useState<ConnectionProfile | null>(null)
  const [formName, setFormName] = useState("")
  const [formEnvironment, setFormEnvironment] = useState("")
  const [formClientId, setFormClientId] = useState("")
  const [formClientSecret, setFormClientSecret] = useState("")
  const [formMcpClientId, setFormMcpClientId] = useState("")
  const [formMcpClientSecret, setFormMcpClientSecret] = useState("")
  const hasAttempted = useRef(false)

  function showDialog() {
    const loaded = allProfiles()
    setProfiles(loaded)
    setView(loaded.length ? "list" : "edit")
    setEditing(null)
    setOpen(true)
  }

  // Plain "connect" goes to the last-used environment; a manage request
  // (gear, environment pill, "Other environment") opens the picker.
  function openDialog(e: Event) {
    const manage = !!(e as CustomEvent<{ manage?: boolean }>).detail?.manage
    if (manage) return showDialog()
    const profile = lastUsedProfile()
    if (profile) return connectProfile(profile)
    showDialog()
  }

  useEffect(() => {
    window.addEventListener("aprimo:open-config", openDialog)
    return () => window.removeEventListener("aprimo:open-config", openDialog)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isConnected) return
    if (window.location.pathname.startsWith("/oauth")) return
    if (hasAttempted.current) return
    // Landing page waits for the user to click Connect; any deep link auto-connects.
    const isLanding = window.location.pathname === "/" && !window.location.search
    if (isLanding) return
    hasAttempted.current = true
    const profile = lastUsedProfile()
    if (profile) connectProfile(profile)
    else showDialog()
  }, [isConnected])

  function connectProfile(profile: ConnectionProfile) {
    localStorage.setItem(LAST_PROFILE_KEY, profile.id)
    setOpen(false)
    startOAuth(profile.environment, profile.clientId, profile.clientSecret || undefined)
  }

  function openNew() {
    setEditing(null)
    setFormName("")
    setFormEnvironment("")
    setFormClientId("")
    setFormClientSecret("")
    setFormMcpClientId("")
    setFormMcpClientSecret("")
    setView("edit")
  }

  function openEdit(profile: ConnectionProfile) {
    setEditing(profile)
    setFormName(profile.name)
    setFormEnvironment(profile.environment)
    setFormClientId(profile.clientId)
    setFormClientSecret(profile.clientSecret)
    setFormMcpClientId(profile.mcpClientId ?? "")
    setFormMcpClientSecret(profile.mcpClientSecret ?? "")
    setView("edit")
  }

  function commitProfile(): ConnectionProfile {
    const profile: ConnectionProfile = {
      id: editing?.id ?? crypto.randomUUID(),
      name: formName.trim() || formEnvironment.trim(),
      environment: formEnvironment.trim(),
      clientId: formClientId.trim(),
      clientSecret: formClientSecret.trim(),
      mcpClientId: formMcpClientId.trim() || undefined,
      mcpClientSecret: formMcpClientSecret.trim() || undefined,
    }
    const updated = editing ? profiles.map((p) => (p.id === editing.id ? profile : p)) : [...profiles, profile]
    persistProfiles(updated)
    setProfiles(updated)
    return profile
  }

  function saveProfile() {
    commitProfile()
    setView("list")
  }

  function saveAndConnect() {
    const profile = commitProfile()
    localStorage.setItem(LAST_PROFILE_KEY, profile.id)
    setOpen(false)
    startOAuth(profile.environment, profile.clientId, profile.clientSecret || undefined)
  }

  function deleteProfile(id: string) {
    const updated = profiles.filter((p) => p.id !== id)
    persistProfiles(updated)
    setProfiles(updated)
    if (localStorage.getItem(LAST_PROFILE_KEY) === id) localStorage.removeItem(LAST_PROFILE_KEY)
  }

  const envTrimmed = formEnvironment.trim()
  const envValid = /^[a-z0-9-]+$/i.test(envTrimmed)
  const formValid = !!(envTrimmed && envValid && formClientId.trim())

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        {view === "list" ? (
          <>
            <DialogHeader>
              <DialogTitle>Connect to Aprimo</DialogTitle>
              <DialogDescription>{profiles.length === 0 ? "Add an environment to get started." : "Pick an environment to connect, or add another. Saved questions and reports are kept per environment."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-1 min-h-[60px]">
              {profiles.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{p.environment}.dam.aprimo.com</div>
                  </div>
                  <span className="flex gap-1 shrink-0">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">API</Badge>
                    {p.mcpClientId && <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">MCP</Badge>}
                  </span>
                  {!p.builtIn && (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Edit" onClick={() => openEdit(p)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" title="Delete" onClick={() => deleteProfile(p.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  <Button size="sm" className="h-7 shrink-0" onClick={() => connectProfile(p)}>
                    Connect
                  </Button>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={openNew}>
                <Plus className="h-4 w-4" /> Add environment
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit environment" : "Add environment"}</DialogTitle>
              <DialogDescription>Two registrations from Aprimo&apos;s Settings, Registrations. Sign-in needs a PKCE one; the assistant&apos;s Aprimo tools need an MCP-type one.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Name</Label>
                <Input id="profile-name" placeholder={formEnvironment || "Production"} value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-environment">Environment</Label>
                <Input id="profile-environment" placeholder="acme" value={formEnvironment} onChange={(e) => setFormEnvironment(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  The subdomain: <span className="font-mono">acme</span> for acme.dam.aprimo.com
                </p>
              </div>
              <div className="pt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Sign-in · PKCE registration · redirect {typeof window !== "undefined" ? window.location.origin : ""}/oauth/callback</div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-client-id">Client ID</Label>
                <Input id="profile-client-id" placeholder="XXXXXXXX-XXXX" value={formClientId} onChange={(e) => setFormClientId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-client-secret">Client secret</Label>
                <Input id="profile-client-secret" type="password" placeholder="From the same registration" value={formClientSecret} onChange={(e) => setFormClientSecret(e.target.value)} />
                <p className="text-xs text-muted-foreground">Needed unless this deployment holds a secret for that environment. Stored only in this browser and sent only to this site&apos;s token exchange.</p>
              </div>
              <div className="pt-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Aprimo tools · MCP registration · redirect {typeof window !== "undefined" ? window.location.origin : ""}/oauth/mcp-callback · optional</div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-mcp-client-id">MCP client ID</Label>
                <Input id="profile-mcp-client-id" placeholder="XXXXXXXX-XXXX" value={formMcpClientId} onChange={(e) => setFormMcpClientId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-mcp-client-secret">MCP client secret</Label>
                <Input id="profile-mcp-client-secret" type="password" placeholder="From the MCP registration" value={formMcpClientSecret} onChange={(e) => setFormMcpClientSecret(e.target.value)} />
                <p className="text-xs text-muted-foreground">Leave both blank to use reports and the assistant without Aprimo tools on this environment.</p>
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              {profiles.length > 0 && (
                <Button variant="outline" className="sm:mr-auto" onClick={() => setView("list")}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
              )}
              <Button variant="outline" disabled={!formValid} onClick={saveProfile}>
                Save
              </Button>
              <Button disabled={!formValid} onClick={saveAndConnect}>
                Save and connect
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
