"use client"

import Link from "next/link"
import { Settings, LogIn } from "lucide-react"
import { useAprimo } from "@/context/aprimo-context"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
import { Wordmark } from "@/components/brand"
import { AprimoWordmark } from "@/components/aprimo-logo"

const ALL_FROM_ENV = !!(process.env.NEXT_PUBLIC_APRIMO_ENVIRONMENT && process.env.NEXT_PUBLIC_APRIMO_CLIENT_ID)

export function TopBar() {
  const { isConnected, connection } = useAprimo()
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-card/95 backdrop-blur">
      <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="shrink-0" aria-label="Report Labs home">
            <Wordmark compact />
          </Link>
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <span className="flex items-center gap-1.5 text-muted-foreground shrink-0" title="Built on the Aprimo DAM APIs">
            <span className="text-[10.5px] uppercase tracking-[0.14em]">for</span>
            <AprimoWordmark className="h-[15px] w-auto text-foreground" />
            <span className="text-[10.5px] uppercase tracking-[0.14em]">DAM</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/architecture" className="hidden md:inline text-xs text-muted-foreground hover:text-foreground mr-1">Architecture</Link>
          {connection?.environment && (
            <span className="hidden sm:inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs font-mono">
              <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-signal" : "bg-muted-foreground"}`} />
              {connection.environment}.dam.aprimo.com
            </span>
          )}
          {!isConnected && (
            <Button size="sm" onClick={() => window.dispatchEvent(new Event("aprimo:open-config"))}>
              <LogIn className="h-4 w-4 mr-1.5" /> Connect
            </Button>
          )}
          {!ALL_FROM_ENV && isConnected && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Connections" onClick={() => window.dispatchEvent(new Event("aprimo:open-config"))}>
              <Settings className="h-4 w-4" />
            </Button>
          )}
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
