"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { RunOutput } from "@/lib/report-spec"

// Renders a saved HTML report in a sandboxed iframe. The page inside can run
// its own script for interactivity but has no network, no same-origin access,
// and no credentials: the host runs the report's queries and posts the results
// in. Theme tokens are injected so the report matches the app in both modes.

const THEME_VARS = [
  "--background", "--foreground", "--card", "--card-foreground", "--muted", "--muted-foreground", "--border", "--primary", "--primary-foreground",
  "--accent", "--accent-foreground", "--signal", "--signal-foreground",
  "--rl-1", "--rl-2", "--rl-3", "--rl-4", "--rl-5", "--rl-seq", "--rl-seq-soft", "--rl-muted", "--rl-grid", "--rl-good", "--rl-bad",
]

function readTheme(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const v of THEME_VARS) out[v] = cs.getPropertyValue(v).trim()
  out["--font-sans"] = cs.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif"
  out["--font-mono"] = cs.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace"
  out["color-scheme"] = document.documentElement.classList.contains("dark") ? "dark" : "light"
  return out
}

function wrap(html: string, theme: Record<string, string>): string {
  const vars = Object.entries(theme)
    .filter(([k]) => k.startsWith("--"))
    .map(([k, v]) => `${k}:${v};`)
    .join("")
  const bridge = `
(function(){
  var data=null, handlers=[];
  window.ReportLabs = {
    get data(){ return data; },
    onData: function(fn){ handlers.push(fn); if(data) { try{ fn(data); }catch(e){ console.error(e); } } },
    ready: function(){ parent.postMessage({type:'rl:ready'}, '*'); }
  };
  function applyTheme(t){ var r=document.documentElement; for (var k in t){ if(k.indexOf('--')===0) r.style.setProperty(k, t[k]); } r.style.colorScheme = t['color-scheme']||'light'; }
  window.addEventListener('message', function(e){
    var m = e.data || {};
    if (m.type === 'rl:data') { data = m.payload; handlers.forEach(function(fn){ try{ fn(data); }catch(err){ console.error(err); } }); }
    if (m.type === 'rl:theme') { applyTheme(m.theme || {}); }
  });
  var send = function(){ parent.postMessage({type:'rl:resize', height: document.documentElement.scrollHeight}, '*'); };
  if (window.ResizeObserver) { new ResizeObserver(send).observe(document.documentElement); }
  window.addEventListener('load', function(){ send(); parent.postMessage({type:'rl:ready'}, '*'); });
})();`
  return `<!doctype html><html style="${vars}color-scheme:${theme["color-scheme"] ?? "light"}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; font-src data:;">
<style>html{background:var(--background);color:var(--foreground);font-family:${theme["--font-sans"] ?? "system-ui, sans-serif"};}body{margin:0;}a{color:inherit}</style>
<script>${bridge}</script></head><body>${html}</body></html>`
}

export function HtmlReportFrame({ html, data, title }: { html: string; data: RunOutput | null; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(480)
  const [ready, setReady] = useState(false)
  const theme = useMemo(() => (typeof window === "undefined" ? {} : readTheme()), [])
  const srcDoc = useMemo(() => wrap(html, theme), [html, theme])

  // Messages from the frame: ready and resize.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return
      const m = e.data ?? {}
      if (m.type === "rl:ready") setReady(true)
      if (m.type === "rl:resize" && typeof m.height === "number") setHeight(Math.max(240, Math.min(6000, m.height)))
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  // Push data whenever it changes and the frame is ready.
  useEffect(() => {
    if (!ready || !data) return
    ref.current?.contentWindow?.postMessage({ type: "rl:data", payload: data }, "*")
  }, [ready, data])

  // Follow theme toggles.
  useEffect(() => {
    const obs = new MutationObserver(() => ref.current?.contentWindow?.postMessage({ type: "rl:theme", theme: readTheme() }, "*"))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="w-full rounded-lg border border-border bg-card"
      style={{ height }}
    />
  )
}
