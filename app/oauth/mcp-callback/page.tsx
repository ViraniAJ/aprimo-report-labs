"use client"

import { useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { completeMcpConsent, readPendingConsent, clearPendingConsent } from "@/lib/mcp-auth"

function McpCallbackContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const run = async () => {
      const pending = readPendingConsent()
      const returnUrl = pending?.returnUrl ?? "/"
      const errorParam = searchParams.get("error")
      const code = searchParams.get("code")
      const state = searchParams.get("state") ?? ""
      if (errorParam) {
        clearPendingConsent()
        toast.error(`Aprimo tools consent declined: ${searchParams.get("error_description") ?? errorParam}`)
        router.replace(returnUrl)
        return
      }
      if (!code) {
        clearPendingConsent()
        toast.error("No authorization code received for Aprimo tools")
        router.replace(returnUrl)
        return
      }
      try {
        await completeMcpConsent(code, state)
        toast.success("Aprimo tools enabled")
      } catch (e) {
        console.error("MCP consent error:", e)
        toast.error(e instanceof Error ? e.message : "Could not enable Aprimo tools")
      }
      router.replace(returnUrl)
    }
    run()
  }, [searchParams, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="mt-4 text-muted-foreground">Enabling Aprimo tools…</p>
      </div>
    </div>
  )
}

export default function McpCallbackPage() {
  return (
    <Suspense>
      <McpCallbackContent />
    </Suspense>
  )
}
