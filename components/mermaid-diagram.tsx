"use client"

import { useEffect, useId, useRef, useState } from "react"

// Renders a Mermaid definition client-side, themed from the app's CSS tokens so
// it matches light and dark mode. Mermaid is loaded on demand, only on pages
// that use it.

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
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
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: cssVar("--font-sans") || "system-ui, sans-serif",
          themeVariables: {
            background: cssVar("--card"),
            primaryColor: cssVar("--card"),
            primaryTextColor: cssVar("--foreground"),
            primaryBorderColor: cssVar("--border"),
            lineColor: cssVar("--muted-foreground"),
            secondaryColor: cssVar("--muted"),
            tertiaryColor: cssVar("--muted"),
            clusterBkg: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.025)",
            clusterBorder: cssVar("--border"),
            edgeLabelBackground: cssVar("--background"),
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
