"use client"

import { useEffect, useId, useRef, useState } from "react"

// Renders a Mermaid definition client-side, themed from the app's CSS tokens so
// it matches light and dark mode. Mermaid is loaded on demand, only on pages
// that use it.

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Mermaid's theme engine only understands hex/rgb. The app's tokens are OKLCH
// and browsers report them back as lab()/oklch(), so normalise through a
// canvas context, which serialises any colour it can parse to #rrggbb.
let ctx: CanvasRenderingContext2D | null | undefined
function toHex(value: string, fallback: string): string {
  if (!value) return fallback
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value.slice(0, 7)
  try {
    if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d")
    if (!ctx) return fallback
    ctx.fillStyle = "#000000"
    ctx.fillStyle = value
    const out = ctx.fillStyle
    if (/^#[0-9a-f]{6}$/i.test(out)) return out
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(out)
    if (m) return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")
    return fallback
  } catch {
    return fallback
  }
}

export function MermaidDiagram({ definition, className = "" }: { definition: string; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "")
  const ref = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function render() {
      try {
        const mermaid = (await import("mermaid")).default
        const dark = document.documentElement.classList.contains("dark")
        const card = toHex(cssVar("--card"), dark ? "#171f24" : "#ffffff")
        const fg = toHex(cssVar("--foreground"), dark ? "#e8eeeb" : "#121a1f")
        const border = toHex(cssVar("--border"), dark ? "#2c3a3f" : "#d9dfdc")
        const muted = toHex(cssVar("--muted"), dark ? "#1f292f" : "#eef1ef")
        const mutedFg = toHex(cssVar("--muted-foreground"), dark ? "#86929a" : "#6f7b82")
        const bg = toHex(cssVar("--background"), dark ? "#10161a" : "#f5f7f6")
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: cssVar("--font-sans") || "system-ui, sans-serif",
          themeVariables: {
            background: card,
            primaryColor: card,
            primaryTextColor: fg,
            primaryBorderColor: border,
            lineColor: mutedFg,
            secondaryColor: muted,
            tertiaryColor: muted,
            clusterBkg: dark ? "#1b242a" : "#f2f4f3",
            clusterBorder: border,
            edgeLabelBackground: bg,
            textColor: fg,
            fontSize: "13px",
          },
          flowchart: { curve: "basis", nodeSpacing: 40, rankSpacing: 60, padding: 12 },
        })
        const { svg } = await mermaid.render(`m${id}`, definition)
        if (!cancelled) {
          setSvg(svg)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    render()
    const obs = new MutationObserver(render)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => {
      cancelled = true
      obs.disconnect()
    }
  }, [definition, id])

  if (error) return <pre className="text-xs text-destructive whitespace-pre-wrap">{error}</pre>
  return <div ref={ref} className={`mermaid-host ${className}`} dangerouslySetInnerHTML={{ __html: svg }} />
}
