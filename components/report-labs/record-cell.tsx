"use client"

import { useState } from "react"
import { ExternalLink, FileImage, ImageOff, Ban, Lock, Clock, CircleAlert } from "lucide-react"
import type { RecordCard } from "@/lib/core"
import { damRecordUrl } from "@/lib/core"

const UNAVAILABLE: Record<NonNullable<RecordCard["unavailable"]>, { label: string; icon: React.ComponentType<{ className?: string }>; hint: string }> = {
  deleted: { label: "deleted", icon: Ban, hint: "This record no longer exists in the DAM. Analytics keeps history for deleted assets." },
  "no-access": { label: "no access", icon: Lock, hint: "Your Aprimo permissions do not allow reading this record." },
  "rate-limited": { label: "rate limited", icon: Clock, hint: "Aprimo rate-limited the lookup. Refresh to try again." },
  error: { label: "lookup failed", icon: CircleAlert, hint: "The record lookup failed." },
}

/** Thumbnail + title + DAM link for a record resolved from an analytics id. */
export function RecordCell({ card, fallbackId, environment }: { card?: RecordCard; fallbackId: string; environment: string }) {
  const shortId = `${fallbackId.slice(0, 8)}…`

  if (card?.unavailable) {
    const u = UNAVAILABLE[card.unavailable]
    const Icon = u.icon
    return (
      <span className="flex items-center gap-2 min-w-0" title={`${fallbackId}\n${u.hint}`}>
        <span className="h-9 w-9 rounded bg-muted shrink-0 flex items-center justify-center">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
        <span className="min-w-0 flex flex-col">
          <span className="font-mono text-xs text-muted-foreground">{shortId}</span>
          <span className="text-[11px] text-muted-foreground">{u.label}</span>
        </span>
      </span>
    )
  }

  const title = card?.title ?? shortId
  return <LoadedCell card={card} fallbackId={fallbackId} environment={environment} title={title} />
}

function LoadedCell({ card, fallbackId, environment, title }: { card?: RecordCard; fallbackId: string; environment: string; title: string }) {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <a
      href={damRecordUrl(environment, card?.id ?? fallbackId)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 min-w-0 group"
      title={card?.title ?? fallbackId}
    >
      <span className="h-9 w-9 rounded bg-muted overflow-hidden shrink-0 flex items-center justify-center">
        {card?.thumbnail && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setImgFailed(true)} />
        ) : imgFailed ? (
          <ImageOff className="h-4 w-4 text-muted-foreground" />
        ) : (
          <FileImage className="h-4 w-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex flex-col">
        <span className={`truncate max-w-[280px] group-hover:underline ${card ? "" : "font-mono text-xs text-muted-foreground"}`}>{title}</span>
        {card?.contentType && <span className="text-[11px] text-muted-foreground truncate">{card.contentType}</span>}
        {card && !card.thumbnail && <span className="text-[11px] text-muted-foreground">no preview</span>}
        {imgFailed && <span className="text-[11px] text-muted-foreground" title={card?.thumbnail}>preview blocked</span>}
      </span>
      <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
    </a>
  )
}
