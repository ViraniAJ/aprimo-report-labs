import Anthropic from "@anthropic-ai/sdk"
import { REPORTS } from "@/lib/registry"

// Classifies assistant questions so the admin page can group them into
// themes, spot which standard report already covers a theme, and see where
// people are asking for things no report provides. Runs as a backfill over
// unclassified rows; a small, fast model is plenty for this.

const MODEL = process.env.REPORT_LABS_CLASSIFY_MODEL || "claude-haiku-4-5-20251001"

export const INTENTS: Record<string, string> = {
  "top-assets": "Ranking or listing assets by views, downloads, plays, or impressions",
  "engagement-trend": "Engagement over time: per day, week, month, or versus a prior period",
  "user-activity": "Who is using the DAM: active users, who downloaded what, departments, adoption",
  "zero-engagement": "Assets never viewed or never downloaded, unused content",
  "new-content": "Records added or growth of the library over a period",
  "library-composition": "What the library holds: content types, formats, file counts, sizes",
  "content-freshness": "Stale, old, expiring, or recently modified content",
  "search-lookup": "Finding specific records or reading a specific asset's metadata, status, or fields",
  "collections": "Collections: their contents or engagement",
  "classifications": "Classifications or taxonomy: engagement or composition by classification",
  "public-links": "Public links, impressions, bandwidth, UTM campaigns",
  "video": "Video or preview plays and viewers",
  "duplicates": "Duplicate assets or redundant storage",
  "marketing-ops": "Projects, tasks, work requests, activities",
  "data-model": "Questions about the analytics schema, cubes, or how reporting works",
  "follow-up": "A continuation with no standalone meaning, such as 'yes', 'go on', 'make it a dashboard'",
  "other": "Anything that does not fit above",
}

export interface Classifiable {
  id: string
  question: string
  /** The same user's previous question shortly before, for context on follow-ups. */
  previous?: string | null
  report_id?: string | null
}

export interface Classification {
  id: string
  intent: string
  topics: string[]
  wants_dashboard: boolean
  matched_report: string | null
}

const REPORT_IDS = new Set(REPORTS.map((r) => r.id))

export async function classifyQuestions(items: Classifiable[]): Promise<Classification[]> {
  if (!items.length) return []
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const anthropic = new Anthropic({ apiKey })

  const system = [
    "You classify questions that users typed into the assistant of Aprimo Report Labs, a DAM reporting tool. Classify every item; return exactly one entry per id.",
    "",
    "Intents (use the key):",
    ...Object.entries(INTENTS).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "Standard reports that already exist (use the id for matched_report when the report would answer the question as asked; null when none would):",
    ...REPORTS.filter((r) => r.group !== "Reference").map((r) => `- ${r.id}: ${r.title}. ${r.description}`),
    "",
    "Rules: for a follow-up, classify by what it continues (use the previous question) and only use 'follow-up' when there is no way to tell. wants_dashboard is true when the user asks to build, create, turn something into, or change a dashboard or saved report. topics are 1 to 4 short lowercase tags covering the metric, the entity, the breakdown, and the timeframe, for example [\"downloads\", \"by user\", \"last 30 days\"].",
  ].join("\n")

  const tool: Anthropic.Tool = {
    name: "record_classifications",
    description: "Record the classification of every question.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              intent: { type: "string", enum: Object.keys(INTENTS) },
              topics: { type: "array", items: { type: "string" }, maxItems: 4 },
              wants_dashboard: { type: "boolean" },
              matched_report: { type: ["string", "null"] },
            },
            required: ["id", "intent", "topics", "wants_dashboard", "matched_report"],
          },
        },
      },
      required: ["items"],
    },
  }

  const out: Classification[] = []
  for (let i = 0; i < items.length; i += 40) {
    const batch = items.slice(i, i + 40)
    const payload = batch.map((b) => ({
      id: b.id,
      question: b.question.slice(0, 600),
      previous: b.previous ? b.previous.slice(0, 300) : undefined,
      report_open: b.report_id ?? undefined,
    }))
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "record_classifications" },
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    })
    const use = res.content.find((c) => c.type === "tool_use")
    const got = ((use?.type === "tool_use" ? (use.input as { items?: Classification[] }).items : undefined) ?? []) as Classification[]
    const byId = new Map(got.map((g) => [g.id, g]))
    for (const b of batch) {
      const g = byId.get(b.id)
      out.push({
        id: b.id,
        intent: g && INTENTS[g.intent] ? g.intent : "other",
        topics: Array.isArray(g?.topics) ? g!.topics.slice(0, 4).map((t) => String(t).toLowerCase().slice(0, 40)) : [],
        wants_dashboard: !!g?.wants_dashboard,
        matched_report: g?.matched_report && REPORT_IDS.has(g.matched_report) ? g.matched_report : null,
      })
    }
  }
  return out
}
