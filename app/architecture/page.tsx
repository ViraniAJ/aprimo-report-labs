import type { Metadata } from "next"
import Link from "next/link"
import { TopBar } from "@/components/topbar"
import { MermaidDiagram } from "@/components/mermaid-diagram"

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

const FLOW = `flowchart LR
  subgraph B [Browser · signed-in user]
    R[Standard reports and saved dashboards]
    P[Assistant panel]
  end
  subgraph S [Vercel server routes]
    T[Token exchange]
    C[Chat route · Claude tool loop]
    D[Saved questions and reports]
  end
  subgraph A [Aprimo · per tenant]
    AN[Analytics API]
    CO[Core API]
    M[MCP server]
  end
  X[(Supabase)]
  L[Anthropic API]
  R -- user token --> AN
  R -- user token --> CO
  P --> C
  C -- user token --> AN
  C -- user token --> CO
  C -- user mcp token --> M
  C --> L
  C --> X
  P --> D
  D --> X
  B -.-> T
  T -.-> A`

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
              <div className="min-w-[720px]"><MermaidDiagram definition={FLOW} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Solid lines carry the user&apos;s own tokens. The server only exchanges tokens, runs the assistant, and reads and writes Supabase.</p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold tracking-tight">What is stored, and what is not</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Stored in Supabase">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
                  <dt className="font-mono text-xs text-foreground">saved_questions</dt><dd>Bookmarked questions per user and environment</dd>
                  <dt className="font-mono text-xs text-foreground">saved_reports</dt><dd>Dashboard specs and views the user saved, private or shared with their environment</dd>
                  <dt className="font-mono text-xs text-foreground">admin_insights</dt><dd>Periodic summaries of the question log for admins</dd>
                  <dt className="font-mono text-xs text-foreground">assistant_log</dt><dd>One row per question: the question text, who asked, tools called, tokens, duration, errors, and a theme label added afterwards</dd>
                </dl>
              </Card>
              <Card title="Never stored">
                <ul className="list-disc pl-5 space-y-1">
                  <li>Assets, files, previews, or metadata values</li>
                  <li>The assistant&apos;s answers or tool results</li>
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
