import { NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod"
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema"
import { McpClient } from "@/lib/mcp"
import { serviceDb } from "@/lib/server/supabase"
import { identify } from "@/lib/server/identity"
import { validateSpec } from "@/lib/report-spec-types"
import { z } from "zod"
import { createClient } from "aprimo-js"
import { analyticsBaseUrl, getAnalyticsMeta, toGuid, analyticsId, type AnalyticsQuery } from "@/lib/analytics"
import { cardExpander, toCard, damRecordUrl } from "@/lib/core"
import { REPORTS } from "@/lib/registry"

// Report Labs assistant. Runs the Claude tool loop server-side with read-only
// tools over the Aprimo Analytics and Core APIs, always using the signed-in
// user's own Aprimo token so their DAM permissions apply. Streams NDJSON
// events to the browser: text deltas, tool activity, and a final done/error.

export const maxDuration = 300

const MODEL = process.env.REPORT_LABS_MODEL || "claude-opus-5"
const MAX_TOOL_ITERATIONS = 12
const MAX_ROWS_TO_MODEL = 200
const MAX_HISTORY = 30

type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; id: number; name: string; input: unknown }
  | { type: "tool_end"; id: number; name: string; ms: number; summary: string; error?: boolean }
  | { type: "report"; report: { title: string; description: string | null; spec: unknown; html: string } }
  | { type: "done"; usage?: { input: number; output: number; cacheRead: number } }
  | { type: "error"; message: string }

const STATIC_SYSTEM = `You are the Aprimo Report Labs assistant, embedded in a reporting tool that sits on top of an Aprimo DAM environment. You answer questions about DAM usage, engagement, and library contents by querying Aprimo's APIs with the tools provided, then presenting what you found clearly.

## Rules
- You are strictly read-only. You cannot change anything in Aprimo and must never imply that you can.
- Every number you report must come from a tool result in this conversation. Never estimate or invent figures. If a query fails, say so, explain what you tried, and try an alternative if one exists.
- Always state the date range a figure covers. If the user did not specify one, use the report context's date range, and say which one you used.
- Every tool call runs as the signed-in user with their permissions. If something is not visible, say that it may be a permissions limit.
- Prefer few, well-chosen queries. Aggregate with measures instead of pulling raw rows. Keep limits small (top 10 to 25) unless the user asks for more.
- Record ids from analytics are 32-character hex strings without dashes. Resolve them to titles with get_record_titles before showing them to a user. Never show a bare id when a title is available.
- Be concise. Lead with the answer, then a compact table or chart, then one or two sentences of interpretation. No preamble about what you are going to do.

## Analytics API (Cube-style queries via query_analytics)
Cubes and members verified in this app:
- Views: measure Views.count; dimensions Views.recordId, Views.collectionId; time dimension DateDimension.date
- Downloads: measure Downloads.count; dimensions Downloads.recordId; time dimension Downloads.downloadDate
- Impressions (public links): measures Impressions.count, Impressions.totalResponseSize; dimensions Impressions.recordId, Impressions.fileName; time dimension Impressions.hitDateTime; UTM breakdown via ImpressionTrackingTypes.queryStringKey and ImpressionTrackingTypeValues.value
- PreviewPlaybacks (video plays): measure PreviewPlaybacks.count; dimension PreviewPlaybacks.recordId; time dimension PreviewPlaybacks.previewPlaybackDate
- ContentEngagement: measures ContentEngagement.viewsCount, ContentEngagement.downloadsCount, ContentEngagement.previewPlaybacksCount; dimensions ContentEngagement.recordId, ContentEngagement.collectionId, RecordMetadata.title; time dimension ContentEngagement.date; filter by classification with Classifications.identifier
- Users joins to Views, Downloads, and PreviewPlaybacks: dimension Users.loginId
Call get_analytics_schema to discover further members (for example rendition or department dimensions) before guessing names.
Query shape: {"measures":[...],"dimensions":[...],"timeDimensions":[{"dimension":"Downloads.downloadDate","granularity":"month","dateRange":["2026-01-01","2026-03-31"]}],"filters":[{"member":"Views.collectionId","operator":"equals","values":["<guid>"]}],"order":{"Downloads.count":"desc"},"limit":10}
Granularity is day, week, or month. Time-bucketed rows carry the bucket in "<dimension>.<granularity>" as well as "<dimension>". Collection filters need the dashed GUID form.
Always include a timeDimensions entry with a dateRange on ranking and breakdown queries; in this environment a query with no time dimension can return zero rows. For "all time" use a wide range such as ["2015-01-01", today].
Record ids from analytics are 32 hex characters, usually uppercase. Pass them to get_record_titles as they are; it handles the form.

## Core API search expressions (count_records, search_records)
Syntax: property comparisons joined with AND, OR, NOT. Operators: = <> > >= < <= in contains. Dates are UTC in 'MM/DD/YYYY' quotes.
System properties: Id, Title, CreatedOn, CreatedBy, ModifiedOn, ModifiedBy, ContentStatus, ContentType, FileCount, Classification, File.Version.FileName, File.Version.FileSize, File.Version.Extension. Custom fields: FieldName("Field Name") = 'value'.
Examples: ContentType = 'Video' | CreatedOn >= '01/01/2026' AND CreatedOn < '02/01/2026' | FileCount = 0 | File.Version.Extension = 'pdf' | Title contains 'summer'
Match everything with: NOT id = ''

## Presenting results
- Use GitHub-flavoured markdown tables for lists. Right-align numbers by putting them in their own column.
- When a tool result includes a "link", make the asset title a markdown link to it so the user can open the record in the DAM.
- For a trend or a ranking, add a chart as a fenced code block with language "chart" containing JSON:
  {"type":"line","title":"Downloads per month","x":"month","series":[{"key":"downloads","label":"Downloads"}],"data":[{"month":"Jan 26","downloads":120}]}
  or {"type":"bar","title":"Top assets by views","x":"label","series":[{"key":"value","label":"Views"}],"data":[{"label":"Hero banner","value":342}]}
  Bar charts rank horizontally; keep them to 12 rows or fewer. Line charts may carry up to 4 series.
- End with at most one short suggested follow-up question when it would genuinely help.

## Building dashboards the user can save (propose_report)
When the user asks for a dashboard, a report to keep, something with sliders or filters, or to change a dashboard you already proposed, call propose_report instead of describing it. The user sees a live preview and can save it under their reports. Then reply with two or three sentences on what it shows and how to adjust it. Never paste the HTML into your reply.

A report has two parts:
1. spec: named read-only queries the host runs as the user on every open and refresh. Shape:
   {"version":1,"defaultRange":"90d","queries":[
     {"id":"trend","kind":"analytics","query":{"measures":["Downloads.count"],"timeDimensions":[{"dimension":"Downloads.downloadDate","granularity":"$granularity","dateRange":"$range"}],"order":{"Downloads.downloadDate":"asc"},"limit":1000}},
     {"id":"top","kind":"analytics","resolveTitles":"Downloads.recordId","query":{"measures":["Downloads.count"],"dimensions":["Downloads.recordId"],"timeDimensions":[{"dimension":"Downloads.downloadDate","dateRange":"$range"}],"order":{"Downloads.count":"desc"},"limit":25}},
     {"id":"total","kind":"search-count","expression":"NOT id = ''"},
     {"id":"recent","kind":"search","expression":"CreatedOn >= $daysAgo(30)","pageSize":20},
     {"id":"types","kind":"content-type-counts"}
   ]}
   Placeholders: "$range" and "$priorRange" for dateRange, "$granularity" for granularity, and in search expressions $daysAgo(N) and $today. The user's date-range selector drives "$range". resolveTitles names the record-id member; those rows gain _title, _thumbnail, _link, _contentType (or _unavailable). Up to 20 queries; keep limits modest.
2. html: the view. A fragment (style, markup, script; no html/head/body tags). It runs in a sandbox with no network and no credentials; it only receives data. Contract: window.ReportLabs.onData(function(payload){...}) is called on load and on every refresh. payload = { results: { [queryId]: { rows?, count?, error?, ms } }, range: [from,to]|null, priorRange, granularity: "day"|"week"|"month", dateRangeKey, environment, refreshedAt }. Analytics rows keep member names as keys ("Downloads.count"); time buckets are under "<dimension>.<granularity>" as well as "<dimension>" (read either). Search rows: { id, title, contentType, status, createdOn, modifiedOn, thumbnail, fileName, fileSize, link }. Content-type rows: { contentType, count }.
   Draw charts with inline SVG and plain script (no libraries). Style with the host's CSS variables so it matches the app in light and dark: --background, --foreground, --card, --muted, --muted-foreground, --border, --primary, --primary-foreground, --font-sans, --font-mono, and the chart palette --rl-1 (views/blue), --rl-2 (downloads/orange), --rl-3 (impressions/aqua), --rl-4 (plays/yellow), --rl-5 (users/violet), --rl-seq for single-hue magnitude, --rl-good, --rl-bad. Controls (range sliders, text filters, segmented toggles) work on the delivered data and re-render instantly. Show a loading state until data arrives, handle empty results and per-query errors, escape all text, keep it under 40 KB, and include a footer with the range and refreshedAt.
   When updating a dashboard you proposed earlier, call propose_report again with the full revised report and the same title.`

function summarize(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    return s.length > 160 ? s.slice(0, 157) + "…" : s
  } catch {
    return String(v)
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: "not_configured", message: "ANTHROPIC_API_KEY is not set on the server. Add it to the Vercel project and redeploy to enable the assistant." },
      { status: 503 },
    )
  }

  let body: {
    environment?: string
    token?: string
    mcpToken?: string
    messages?: { role: "user" | "assistant"; content: string }[]
    context?: {
      reportId?: string
      dateRangeKey?: string
      dateRange?: [string, string] | null
      collectionName?: string | null
      editingReport?: { id: string; title: string; description?: string | null; spec: unknown; html: string }
    }
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "bad_request", message: "Invalid JSON body" }, { status: 400 })
  }
  const { environment, token, mcpToken, messages, context } = body
  if (!environment || !token || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "bad_request", message: "Missing environment, token, or messages" }, { status: 400 })
  }
  if (!/^[a-z0-9-]+$/i.test(environment)) {
    return Response.json({ error: "bad_request", message: "Invalid environment" }, { status: 400 })
  }

  const authHeader = `Bearer ${token}`
  const aprimo = createClient({ type: "custom", environment, tokenProvider: async () => token })
  const anthropic = new Anthropic({ apiKey })

  const encoder = new TextEncoder()
  let toolSeq = 0
  const toolNames: string[] = []
  const startedAt = Date.now()
  let answerChars = 0
  // Identity for the usage log; resolved in parallel with the first model call.
  const identityPromise = serviceDb() ? identify(environment, token).catch(() => null) : Promise.resolve(null)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"))
        } catch {
          /* client gone */
        }
      }

      const traced = <I, O>(name: string, fn: (input: I) => Promise<O>) => async (input: I): Promise<string> => {
        const id = ++toolSeq
        const started = Date.now()
        toolNames.push(name)
        emit({ type: "tool_start", id, name, input })
        try {
          const out = await fn(input)
          const text = typeof out === "string" ? out : JSON.stringify(out)
          emit({ type: "tool_end", id, name, ms: Date.now() - started, summary: summarize(out) })
          return text
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          emit({ type: "tool_end", id, name, ms: Date.now() - started, summary: msg, error: true })
          return `ERROR: ${msg}`
        }
      }

      // ── Tools (all read-only) ─────────────────────────────────────────────
      const getAnalyticsSchema = betaZodTool({
        name: "get_analytics_schema",
        description: "Lists every cube with its measures and dimensions from the Analytics API schema. Call this before using a member name that is not in the verified list.",
        inputSchema: z.object({ cube: z.string().optional().describe("Return only this cube, e.g. Downloads") }),
        run: traced("get_analytics_schema", async ({ cube }) => {
          const meta = await getAnalyticsMeta(environment, authHeader)
          const cubes = cube ? meta.filter((c) => c.name.toLowerCase() === cube.toLowerCase()) : meta
          return cubes.map((c) => ({ cube: c.name, measures: c.measures.map((m) => m.name), dimensions: c.dimensions.map((d) => `${d.name}${d.type ? ` (${d.type})` : ""}`) }))
        }),
      })

      const queryAnalyticsTool = betaZodTool({
        name: "query_analytics",
        description: "Runs one Analytics API query. Returns up to 200 rows. Use measures for aggregates, dimensions to group, timeDimensions for date ranges and time buckets, filters to restrict, order and limit to rank.",
        inputSchema: z.object({
          measures: z.array(z.string()).optional(),
          dimensions: z.array(z.string()).optional(),
          timeDimensions: z
            .array(z.object({ dimension: z.string(), granularity: z.enum(["day", "week", "month"]).optional(), dateRange: z.array(z.string()).length(2).optional() }))
            .optional(),
          filters: z.array(z.object({ member: z.string(), operator: z.string(), values: z.array(z.string()).optional() })).optional(),
          order: z.record(z.string(), z.enum(["asc", "desc"])).optional(),
          limit: z.number().int().min(1).max(2000).optional(),
        }),
        run: traced("query_analytics", async (input) => {
          const q: AnalyticsQuery = {
            ...input,
            timeDimensions: input.timeDimensions?.map((t) => ({ ...t, dateRange: t.dateRange as [string, string] | undefined })),
            limit: Math.min(input.limit ?? 100, 2000),
          }
          const url = `${analyticsBaseUrl(environment)}/?query=${encodeURIComponent(JSON.stringify(q))}`
          const res = await fetch(url, { headers: { Authorization: authHeader } })
          if (!res.ok) throw new Error(`Analytics API ${res.status}: ${(await res.text()).slice(0, 400)}`)
          const json = await res.json()
          const rows = (json.data ?? []) as unknown[]
          return { rowCount: rows.length, truncated: rows.length > MAX_ROWS_TO_MODEL, rows: rows.slice(0, MAX_ROWS_TO_MODEL) }
        }),
      })

      const countRecords = betaZodTool({
        name: "count_records",
        description: "Counts DAM records matching an Aprimo search expression. Cheap; use it for totals and breakdowns by running several expressions.",
        inputSchema: z.object({ expression: z.string().describe("Aprimo search expression, e.g. ContentType = 'Image' AND CreatedOn >= '01/01/2026'") }),
        run: traced("count_records", async ({ expression }) => {
          const res = await aprimo.search.records({ searchExpression: { expression }, page: 1, pageSize: 1 } as never)
          if (!res.ok) throw new Error((res as { error?: { message?: string } }).error?.message ?? "Search failed")
          return { expression, totalCount: (res.data as unknown as { totalCount?: number })?.totalCount ?? 0 }
        }),
      })

      const searchRecords = betaZodTool({
        name: "search_records",
        description: "Searches DAM records by expression and returns basic details for up to 50 records: id, title, content type, status, created and modified dates, file name and size.",
        inputSchema: z.object({ expression: z.string(), pageSize: z.number().int().min(1).max(50).optional(), page: z.number().int().min(1).optional() }),
        run: traced("search_records", async ({ expression, pageSize, page }) => {
          const res = await aprimo.search.records({ searchExpression: { expression }, page: page ?? 1, pageSize: pageSize ?? 20 } as never, cardExpander() as never)
          if (!res.ok) throw new Error((res as { error?: { message?: string } }).error?.message ?? "Search failed")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = res.data as unknown as { items?: any[]; totalCount?: number }
          return {
            totalCount: data.totalCount ?? 0,
            items: (data.items ?? []).map((r) => {
              const c = toCard(r)
              return { id: c.key, title: c.title, contentType: c.contentType, status: c.status, createdOn: c.createdOn, modifiedOn: c.modifiedOn, fileName: c.fileName, fileSize: c.fileSize, link: damRecordUrl(environment, c.key) }
            }),
          }
        }),
      })

      const getRecordTitles = betaZodTool({
        name: "get_record_titles",
        description: "Resolves analytics record ids (32-char hex, no dashes) or GUIDs to titles and content types. Up to 50 ids per call.",
        inputSchema: z.object({ ids: z.array(z.string()).min(1).max(50) }),
        run: traced("get_record_titles", async ({ ids }) => {
          const out: Array<{ id: string; title?: string; contentType?: string; link?: string; error?: string }> = []
          const queue = [...ids]
          const workers = Array.from({ length: 5 }, async () => {
            while (queue.length) {
              const id = queue.shift()!
              try {
                const res = await aprimo.records.getById(toGuid(id), cardExpander() as never)
                if (res.ok) {
                  const c = toCard(res.data)
                  out.push({ id, title: c.title, contentType: c.contentType, link: damRecordUrl(environment, analyticsId(id)) })
                } else out.push({ id, error: "not found or no permission" })
              } catch (e) {
                out.push({ id, error: e instanceof Error ? e.message : String(e) })
              }
            }
          })
          await Promise.all(workers)
          return out
        }),
      })

      const listContentTypes = betaZodTool({
        name: "list_content_types",
        description: "Lists the content types defined in this environment.",
        inputSchema: z.object({}),
        run: traced("list_content_types", async () => {
          const names: string[] = []
          for await (const page of aprimo.contentTypes.getPaged({ pageSize: 1000 })) {
            if (!page.ok) break
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const ct of (page.data?.items ?? []) as any[]) names.push(ct.name)
          }
          return names.sort()
        }),
      })

      const listCollections = betaZodTool({
        name: "list_collections",
        description: "Lists collections with their ids (dashed GUIDs) and types. Use the id in Views.collectionId or ContentEngagement.collectionId filters.",
        inputSchema: z.object({ nameContains: z.string().optional() }),
        run: traced("list_collections", async ({ nameContains }) => {
          const out: Array<{ id: string; name: string; type?: string }> = []
          for await (const page of aprimo.collections.getPaged({ pageSize: 1000 })) {
            if (!page.ok) break
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const c of (page.data?.items ?? []) as any[]) out.push({ id: c.id, name: c.name, type: c.type })
          }
          const f = nameContains?.toLowerCase()
          return (f ? out.filter((c) => c.name.toLowerCase().includes(f)) : out).slice(0, 200)
        }),
      })

      const proposeReport = betaZodTool({
        name: "propose_report",
        description: "Proposes a saveable dashboard: a spec of read-only queries plus an HTML view that receives the data. The user sees a live preview and can save it. Use for any request for a dashboard, a report to keep, or interactive controls.",
        inputSchema: z.object({
          title: z.string().min(1).max(160),
          description: z.string().max(600).optional(),
          spec: z.object({ version: z.literal(1), defaultRange: z.string().optional(), queries: z.array(z.record(z.string(), z.unknown())).min(1).max(20) }),
          html: z.string().min(50).max(120_000),
        }),
        run: traced("propose_report", async (input) => {
          if (!validateSpec(input.spec)) throw new Error("Spec rejected: every query needs an id and a kind of analytics (with query), search-count / search (with expression), or content-type-counts; limits must be 5000 or less.")
          if (!/ReportLabs\.onData\s*\(/.test(input.html)) throw new Error("HTML rejected: it must register window.ReportLabs.onData(function(payload){...}) to receive data.")
          if (/<\s*(script|link)[^>]+src=/i.test(input.html)) throw new Error("HTML rejected: external scripts and stylesheets are not allowed; inline everything.")
          emit({ type: "report", report: { title: input.title, description: input.description ?? null, spec: input.spec, html: input.html } })
          return `Report "${input.title}" is now previewed for the user with ${input.spec.queries.length} queries. They can save it. Reply briefly; do not repeat the HTML.`
        }),
      })

      // ── Aprimo MCP tools (read-only allowlist), when the user has consented ──
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mcpTools: any[] = []
      let mcpNote = "Aprimo MCP tools are not enabled for this user; use the analytics and record tools only."
      if (mcpToken) {
        try {
          const mcp = new McpClient(environment, mcpToken)
          await mcp.initialize()
          const defs = await mcp.listAllowedTools()
          for (const def of defs) {
            const schema = { ...(def.inputSchema as Record<string, unknown>), type: "object" } as { type: "object"; [k: string]: unknown }
            mcpTools.push(
              betaTool({
                name: def.name,
                description: def.description ?? def.name,
                inputSchema: schema,
                run: traced(def.name, async (input: unknown) => {
                  const r = await mcp.callTool(def.name, (input ?? {}) as Record<string, unknown>)
                  if (r.isError) throw new Error(r.text.slice(0, 500))
                  return r.text
                }),
              }),
            )
          }
          mcpNote = `Aprimo MCP tools are enabled (${defs.length} read-only tools: ${defs.map((d) => d.name).join(", ")}). Prefer list_records and get_record_metadata for titles, status, and metadata; they return proper titles and deep links. Use search_aprimo for keyword relevance. Analytics questions still go through query_analytics.`
        } catch (e) {
          mcpNote = `Aprimo MCP tools could not be connected (${e instanceof Error ? e.message : String(e)}); use the analytics and record tools only.`
        }
      }

      // ── Dynamic context (kept out of the cached prefix) ───────────────────
      const report = REPORTS.find((r) => r.id === context?.reportId)
      const today = new Date().toISOString().slice(0, 10)
      const dynamic = [
        `Today is ${today}. Aprimo environment: ${environment}.`,
        report ? `The user is looking at the "${report.title}" report: ${report.description}` : "The user is on the Report Labs landing page.",
        context?.dateRange ? `The report date range is ${context.dateRange[0]} to ${context.dateRange[1]} (${context.dateRangeKey}).` : "The report date range is all time.",
        context?.collectionName ? `The reports are scoped to the collection "${context.collectionName}".` : "",
        `Available standard reports: ${REPORTS.map((r) => r.title).join(", ")}. When a standard report answers the question, mention it by name.`,
        mcpNote,
        context?.editingReport
          ? `The user has their saved dashboard "${context.editingReport.title}" open and may ask you to change it. Its current spec and view are below. For any change, call propose_report with the FULL revised report, keeping the same title unless asked to rename; saving will update this report in place.\n\nCURRENT SPEC:\n${JSON.stringify(context.editingReport.spec)}\n\nCURRENT HTML:\n${context.editingReport.html.slice(0, 60_000)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")

      const history = messages.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }))

      // Usage log: one row per question, written after the answer completes.
      const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? ""
      async function logRun(o: { usage: { input: number; output: number; cacheRead: number } | null; error: string | null }) {
        const db = serviceDb()
        if (!db) return
        const who = await identityPromise
        if (!who) return
        try {
          await db.from("assistant_log").insert({
            environment: who.environment,
            user_id: who.userId,
            user_login: who.login || null,
            question: lastUser.slice(0, 4000),
            report_id: context?.reportId ?? null,
            date_range: context?.dateRangeKey ?? null,
            mcp_enabled: !!mcpToken,
            tools: toolNames,
            answer_chars: answerChars,
            input_tokens: o.usage?.input ?? null,
            output_tokens: o.usage?.output ?? null,
            cache_read_tokens: o.usage?.cacheRead ?? null,
            duration_ms: Date.now() - startedAt,
            error: o.error,
          })
        } catch (e) {
          console.error("[assistant_log]", e)
        }
      }

      try {
        const runner = anthropic.beta.messages.toolRunner({
          model: MODEL,
          max_tokens: 24000,
          system: [
            { type: "text", text: STATIC_SYSTEM, cache_control: { type: "ephemeral" } },
            { type: "text", text: dynamic },
          ],
          messages: history,
          tools: [getAnalyticsSchema, queryAnalyticsTool, countRecords, searchRecords, getRecordTitles, listContentTypes, listCollections, proposeReport, ...mcpTools],
          max_iterations: MAX_TOOL_ITERATIONS,
          stream: true,
        })

        let usage = { input: 0, output: 0, cacheRead: 0 }
        for await (const messageStream of runner) {
          for await (const event of messageStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              answerChars += event.delta.text.length
              emit({ type: "text", text: event.delta.text })
            }
          }
          const msg = await messageStream.finalMessage()
          usage = {
            input: usage.input + (msg.usage.input_tokens ?? 0),
            output: usage.output + (msg.usage.output_tokens ?? 0),
            cacheRead: usage.cacheRead + (msg.usage.cache_read_input_tokens ?? 0),
          }
          if (msg.stop_reason === "pause_turn") runner.pushMessages({ role: "assistant", content: msg.content })
          if (msg.stop_reason === "refusal") emit({ type: "text", text: "\n\nI can't help with that request." })
        }
        emit({ type: "done", usage })
        await logRun({ usage, error: null })
      } catch (e) {
        let message = e instanceof Error ? e.message : String(e)
        if (e instanceof Anthropic.AuthenticationError) message = "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server."
        else if (e instanceof Anthropic.RateLimitError) message = "The Anthropic API is rate limiting requests. Try again in a moment."
        else if (e instanceof Anthropic.APIError) message = `Anthropic API error ${e.status}: ${e.message}`
        emit({ type: "error", message })
        await logRun({ usage: null, error: message })
      } finally {
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  })
}
