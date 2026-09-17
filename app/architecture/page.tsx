import type { Metadata } from "next"
import Link from "next/link"
import { TopBar } from "@/components/topbar"

export const metadata: Metadata = { title: "Architecture" }

// Public reference page: how Report Labs is built and how it talks to Aprimo.
// Kept in step with the assistant's system prompt and the README.

function Tag({ kind, children }: { kind: "rest" | "mcp" | "ai" | "both"; children: React.ReactNode }) {
  const cls = {
    rest: "text-[var(--rl-1)] bg-[var(--rl-1)]/12",
    mcp: "text-[var(--rl-5)] bg-[var(--rl-5)]/12",
    ai: "text-[var(--rl-2)] bg-[var(--rl-2)]/12",
    both: "text-foreground bg-muted",
  }[kind]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap ${cls}`}>{children}</span>
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 min-w-0">
      <h3 className="text-sm font-semibold mb-1.5">{title}</h3>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </div>
  )
}

function Diagram() {
  // Boxes: x, y, w, h. Colours via CSS vars so both themes hold.
  const box = (x: number, y: number, w: number, h: number, label: string, sub?: string, accent?: string) => (
    <g key={label}>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="var(--card)" stroke={accent ?? "var(--border)"} strokeWidth={accent ? 1.5 : 1} />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 4 : h / 2 + 5)} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">{label}</text>
      {sub && <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{sub}</text>}
    </g>
  )
  const arrow = (x1: number, y1: number, x2: number, y2: number, color: string, dashed?: boolean) => (
    <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.75} strokeDasharray={dashed ? "5 4" : undefined} markerEnd="url(#arrow)" />
  )
  return (
    <svg viewBox="0 0 960 400" className="w-full h-auto" role="img" aria-label="Report Labs data flow: browser to Aprimo APIs directly; server routes for token exchange, the assistant, and Supabase.">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      {/* Lanes */}
      <text x={20} y={26} fontSize="11" fontWeight="600" letterSpacing="1.5" fill="var(--muted-foreground)">BROWSER · SIGNED-IN USER</text>
      <text x={360} y={26} fontSize="11" fontWeight="600" letterSpacing="1.5" fill="var(--muted-foreground)">VERCEL SERVER ROUTES</text>
      <text x={700} y={26} fontSize="11" fontWeight="600" letterSpacing="1.5" fill="var(--muted-foreground)">APRIMO · PER TENANT</text>
      <line x1={340} y1={36} x2={340} y2={390} stroke="var(--border)" strokeDasharray="3 5" />
      <line x1={680} y1={36} x2={680} y2={390} stroke="var(--border)" strokeDasharray="3 5" />

      {box(20, 50, 300, 64, "Standard reports and saved dashboards", "queries run in the browser, as the user")}
      {box(20, 150, 300, 56, "Assistant panel", "questions, previews, save")}
      {box(20, 300, 300, 56, "Login and MCP consent", "PKCE, scopes api and mcp")}

      {box(360, 50, 300, 56, "Chat route", "Claude tool loop, read-only tools", "var(--rl-2)")}
      {box(360, 150, 300, 56, "Saved questions and reports", "service key, rows per user and environment")}
      {box(360, 300, 300, 56, "Token exchange", "client secrets stay here")}

      {box(700, 50, 240, 56, "Analytics API", "views, downloads, impressions, plays", "var(--rl-1)")}
      {box(700, 150, 240, 56, "Core API", "records, counts, classifications", "var(--rl-1)")}
      {box(700, 250, 240, 56, "MCP server", "23 of 200 tools, read-only", "var(--rl-5)")}

      {box(360, 230, 140, 44, "Anthropic API", undefined, "var(--rl-2)")}
      {box(520, 230, 140, 44, "Supabase")}

      {/* Browser → Aprimo directly */}
      {arrow(320, 70, 700, 70, "var(--rl-1)")}
      {arrow(320, 90, 700, 172, "var(--rl-1)")}
      {/* Panel → chat route */}
      {arrow(320, 178, 360, 90, "var(--muted-foreground)")}
      {arrow(320, 190, 360, 178, "var(--muted-foreground)")}
      {/* Chat route → Aprimo + Anthropic + Supabase */}
      {arrow(660, 66, 700, 66, "var(--rl-1)")}
      {arrow(660, 90, 700, 162, "var(--rl-1)")}
      {arrow(660, 100, 700, 268, "var(--rl-5)")}
      {arrow(470, 106, 430, 230, "var(--rl-2)")}
      {arrow(560, 106, 590, 230, "var(--muted-foreground)")}
      {arrow(560, 206, 590, 230, "var(--muted-foreground)")}
      {/* Login → token exchange → Aprimo */}
      {arrow(320, 328, 360, 328, "var(--muted-foreground)", true)}
      {arrow(660, 328, 700, 300, "var(--muted-foreground)", true)}

      <text x={20} y={385} fontSize="11" fill="var(--muted-foreground)">Blue: REST calls with the user's token. Violet: MCP calls with the user's mcp token. Orange: model calls with the server key. Dashed: OAuth code exchange.</text>
    </svg>
  )
}

export default function ArchitecturePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TopBar />
      <main className="flex-1 px-5 sm:px-8 py-10">
        <div className="max-w-5xl mx-auto flex flex-col gap-10">
          <header className="flex flex-col gap-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Architecture</p>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight max-w-3xl" style={{ textWrap: "balance" }}>How Report Labs is built and how it talks to Aprimo</h1>
            <p className="text-muted-foreground max-w-2xl">What the stack is, how each connection is authorised, and which features use Aprimo&apos;s REST APIs versus its MCP server.</p>
          </header>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold tracking-tight">The stack in one line</h2>
            <p className="max-w-3xl text-sm sm:text-[15px]">A Next.js app on Vercel, one deployment per customer, with Supabase for a small amount of app state and Claude for the assistant. All Aprimo data comes from Aprimo&apos;s own APIs and MCP server at the moment it is asked for. There is no middleware layer, no data warehouse, and no copy of DAM content anywhere.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card title="Next.js on Vercel">Reports render in the browser; a few server routes hold secrets and run the assistant. Git push deploys.</Card>
              <Card title="Supabase">Saved questions, saved dashboards, and an assistant usage log. Server-side access only, rows scoped per user and environment.</Card>
              <Card title="Claude via the Anthropic API">Reasoning and tool use for the assistant and dashboard authoring. Key owned by the organisation, never in the browser.</Card>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold tracking-tight">Three connections, all as the signed-in person</h2>
            <p className="max-w-3xl text-sm sm:text-[15px]">Nothing runs under a service account. Every call to Aprimo carries the user&apos;s own token, so Aprimo&apos;s permissions are the only permission model.</p>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="text-left px-3 py-2 font-semibold">Connection</th><th className="text-left px-3 py-2 font-semibold">Used for</th><th className="text-left px-3 py-2 font-semibold">Authorisation</th></tr>
                </thead>
                <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_tr]:border-t [&_tr]:border-border">
                  <tr><td><Tag kind="rest">REST</Tag> <span className="ml-1">Aprimo Analytics and Core APIs</span></td><td>Every standard report, every saved dashboard, and the assistant&apos;s numeric answers</td><td>PKCE login, scope <code className="font-mono text-xs">api</code>. Same registration type as Aprimo Editor Tools. Client secret held server-side.</td></tr>
                  <tr><td><Tag kind="mcp">MCP</Tag> <span className="ml-1">Aprimo MCP server</span></td><td>The assistant&apos;s metadata, search, classification, collection, and marketing operations lookups</td><td>Second consent from the panel, scope <code className="font-mono text-xs">mcp</code>, on a separate MCP-type registration. Refresh tokens keep it alive.</td></tr>
                  <tr><td><Tag kind="ai">AI</Tag> <span className="ml-1">Anthropic API</span></td><td>Model calls for the assistant</td><td>Server-side key per deployment. Users need no Anthropic account.</td></tr>
                </tbody>
              </table>
            </div>
            <div className="rounded-r-lg border-l-[3px] border-signal bg-card px-4 py-3 text-sm max-w-3xl">
              Aprimo binds OAuth scopes to registration types: a login registration cannot issue <code className="font-mono text-xs">mcp</code>, and an MCP registration cannot issue <code className="font-mono text-xs">api</code>. That is why the MCP has its own one-time consent instead of riding on the login.
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold tracking-tight">API or MCP, by feature</h2>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="text-left px-3 py-2 font-semibold">Feature</th><th className="text-left px-3 py-2 font-semibold">Source</th><th className="text-left px-3 py-2 font-semibold">Why</th></tr>
                </thead>
                <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_tr]:border-t [&_tr]:border-border">
                  <tr><td>Standard reports</td><td><Tag kind="rest">REST</Tag></td><td>The MCP server exposes no analytics. Engagement comes from the Analytics API; library counts and record details from the Core API.</td></tr>
                  <tr><td>Saved dashboards and refresh</td><td><Tag kind="rest">REST</Tag></td><td>A dashboard is a spec of read-only queries, re-run as the user on every open and refresh.</td></tr>
                  <tr><td>Assistant: numbers, rankings, trends</td><td><Tag kind="rest">REST</Tag></td><td>Seven built-in tools over the Analytics and Core APIs, including a title join so rankings need no per-record lookups.</td></tr>
                  <tr><td>Assistant: metadata, search, classifications, projects, tasks</td><td><Tag kind="mcp">MCP</Tag></td><td>Twenty-three read-only tools bridged from the server&apos;s two hundred, active only after the user enables Aprimo tools.</td></tr>
                  <tr><td>Assistant: building a dashboard</td><td><Tag kind="both">both</Tag></td><td>The model gathers data through either path, then returns a spec plus a view; the app runs the spec, not the model.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Where things run</h2>
            <div className="rounded-lg border border-border bg-card p-3 overflow-x-auto">
              <div className="min-w-[760px]"><Diagram /></div>
            </div>
            <p className="text-xs text-muted-foreground">Report queries go straight from the browser to Aprimo. The server only exchanges tokens, runs the assistant, and reads and writes Supabase.</p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold tracking-tight">What is stored, and what is not</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Stored in Supabase">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
                  <dt className="font-mono text-xs text-foreground">saved_questions</dt><dd>Bookmarked questions per user and environment</dd>
                  <dt className="font-mono text-xs text-foreground">saved_reports</dt><dd>Dashboard specs and views the user saved</dd>
                  <dt className="font-mono text-xs text-foreground">assistant_log</dt><dd>One row per question: tools called, tokens, duration, errors</dd>
                </dl>
              </Card>
              <Card title="Never stored">
                <ul className="list-disc pl-5 space-y-1">
                  <li>Assets, files, previews, or metadata values</li>
                  <li>Per-user activity from Aprimo</li>
                  <li>Aprimo tokens on the server</li>
                  <li>Query results: every open re-queries Aprimo</li>
                </ul>
              </Card>
            </div>
            <p className="text-sm text-muted-foreground max-w-3xl">Identity for those rows is verified from the signature of the user&apos;s Aprimo token against Aprimo&apos;s published keys, with no extra API call.</p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Guardrails</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-sm max-w-3xl">
              <li><strong>Permissions are Aprimo&apos;s.</strong> Every call runs as the user; Report Labs adds no access of its own.</li>
              <li><strong>The assistant is read-only by construction.</strong> The MCP server&apos;s write tools are never registered with the model, and the bridge refuses any tool outside the allowlist.</li>
              <li><strong>Authored dashboards are sandboxed.</strong> No network, no credentials, data pushed in by the host page. The spec is validated server-side before it can be saved.</li>
              <li><strong>Everything is attributable.</strong> Each assistant run is logged with the tools it used and what it cost. Aprimo&apos;s audit log covers the rest, since the calls are the user&apos;s.</li>
            </ul>
          </section>

          <p className="text-xs text-muted-foreground">
            <Link href="/" className="underline underline-offset-2 hover:text-foreground">Back to Report Labs</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
