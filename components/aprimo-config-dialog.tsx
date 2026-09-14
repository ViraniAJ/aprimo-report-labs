"use client"

import { useState, useEffect, useRef } from "react"
import { useAprimo } from "@/context/aprimo-context"
import { generatePKCE, buildAuthorizationUrl } from "@/lib/pkce"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil, Trash2, Plus, ArrowLeft } from "lucide-react"

// Connection handling for Report Labs.
//
// Deployed mode: NEXT_PUBLIC_APRIMO_ENVIRONMENT and NEXT_PUBLIC_APRIMO_CLIENT_ID
// are set, the client secret lives server-side (APRIMO_CLIENT_SECRET), and the
// app starts the PKCE flow automatically on any page except the landing page.
//
// Self-managed mode: no env vars, the user keeps connection profiles in the
// browser. A profile needs only environment and client id; a secret is
// optional and only used when the server has none.

const ENV_ENVIRONMENT = process.env.NEXT_PUBLIC_APRIMO_ENVIRONMENT ?? ""
const ENV_CLIENT_ID = process.env.NEXT_PUBLIC_APRIMO_CLIENT_ID ?? ""
const ALL_FROM_ENV = !!(ENV_ENVIRONMENT && ENV_CLIENT_ID)

interface ConnectionProfile {
  id: string
  name: string
  environment: string
  clientId: string
  clientSecret: string
}

const PROFILES_KEY = "report_labs_profiles"
const LAST_PROFILE_KEY = "report_labs_last_profile_id"

function loadProfiles(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistProfiles(profiles: ConnectionProfile[]) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
}

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
  const hasAttempted = useRef(false)

  function openDialog() {
    if (ALL_FROM_ENV) {
      startOAuth(ENV_ENVIRONMENT, ENV_CLIENT_ID)
      return
    }
    const loaded = loadProfiles()
    setProfiles(loaded)
    setView(loaded.length ? "list" : "edit")
    setEditing(null)
    setOpen(true)
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
    if (ALL_FROM_ENV) {
      startOAuth(ENV_ENVIRONMENT, ENV_CLIENT_ID)
      return
    }
    const loaded = loadProfiles()
    setProfiles(loaded)
    if (loaded.length === 0) {
      setView("edit")
      setOpen(true)
    } else {
      const lastId = localStorage.getItem(LAST_PROFILE_KEY)
      const profile = (lastId ? loaded.find((p) => p.id === lastId) : null) ?? loaded[0]
      localStorage.setItem(LAST_PROFILE_KEY, profile.id)
      startOAuth(profile.environment, profile.clientId, profile.clientSecret || undefined)
    }
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
    setView("edit")
  }

  function openEdit(profile: ConnectionProfile) {
    setEditing(profile)
    setFormName(profile.name)
    setFormEnvironment(profile.environment)
    setFormClientId(profile.clientId)
    setFormClientSecret(profile.clientSecret)
    setView("edit")
  }

  function commitProfile(): ConnectionProfile {
    const profile: ConnectionProfile = {
      id: editing?.id ?? crypto.randomUUID(),
      name: formName.trim() || formEnvironment.trim(),
      environment: formEnvironment.trim(),
      clientId: formClientId.trim(),
      clientSecret: formClientSecret.trim(),
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
  }

  const envTrimmed = formEnvironment.trim()
  const envValid = /^[a-z0-9-]+$/i.test(envTrimmed)
  const formValid = !!(envTrimmed && envValid && formClientId.trim())

  if (ALL_FROM_ENV) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        {view === "list" ? (
          <>
            <DialogHeader>
              <DialogTitle>Connect to Aprimo</DialogTitle>
              <DialogDescription>{profiles.length === 0 ? "Add an environment to get started." : "Pick an environment to connect, or manage saved ones."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-1 min-h-[60px]">
              {profiles.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{p.environment}.dam.aprimo.com</div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Edit" onClick={() => openEdit(p)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" title="Delete" onClick={() => deleteProfile(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
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
              <DialogDescription>Enter the Aprimo environment and the client id of a PKCE registration whose redirect URI is this site's /oauth/callback.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
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
              <div className="space-y-1.5">
                <Label htmlFor="profile-client-id">Client ID</Label>
                <Input id="profile-client-id" placeholder="XXXXXXXX-XXXX" value={formClientId} onChange={(e) => setFormClientId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-client-secret">Client secret (optional)</Label>
                <Input id="profile-client-secret" type="password" placeholder="Only if the server does not hold one" value={formClientSecret} onChange={(e) => setFormClientSecret(e.target.value)} />
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
