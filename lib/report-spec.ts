"use client"

// The data plane for saved reports. A report is a declarative spec of named
// queries; running it as the signed-in user produces a results object that is
// handed to the view (the app's components, or a sandboxed HTML page). The
// view never touches Aprimo itself, so a report can be refreshed at any time.

import { queryAnalytics, getDateRange, getPriorRange, getGranularity, str, type AnalyticsQuery, type DateRange, type DateRangeKey, type Granularity } from "@/lib/analytics"
import { countRecords, searchRecordCards, fetchRecordCards, listContentTypes, runThrottled, escapeExpr, dateLiteral, type AprimoClient, type RecordCard } from "@/lib/core"

export type SpecQuery =
  | {
      id: string
      kind: "analytics"
      /** Cube query. Placeholders: "$range" / "$priorRange" for dateRange, "$granularity" for granularity. */
      query: Omit<AnalyticsQuery, "timeDimensions"> & { timeDimensions?: Array<{ dimension: string; granularity?: Granularity | "$granularity"; dateRange?: DateRange | "$range" | "$priorRange" }> }
      /** When set, rows carrying this record-id member get _title, _thumbnail, _link, _contentType. */
      resolveTitles?: string
    }
  /** Expressions may use $daysAgo(N) and $today, replaced with 'MM/DD/YYYY' literals. */
  | { id: string; kind: "search-count"; expression: string }
  | { id: string; kind: "search"; expression: string; pageSize?: number }
  /** One count per content type: rows of { contentType, count }. */
  | { id: string; kind: "content-type-counts"; extraExpression?: string }

export interface ReportSpec {
  version: 1
  /** Default range if the user has not chosen one. */
  defaultRange?: DateRangeKey
  queries: SpecQuery[]
}

export interface QueryResult {
  id: string
  kind: SpecQuery["kind"]
  rows?: unknown[]
  count?: number
  error?: string
  ms: number
}

export interface RunContext {
  environment: string
  authHeader: string
  client: AprimoClient
  dateRangeKey: DateRangeKey
}

export interface RunOutput {
  results: Record<string, QueryResult>
  range: DateRange | null
  priorRange: DateRange | null
  granularity: Granularity
  dateRangeKey: DateRangeKey
  environment: string
  refreshedAt: string
}

const ALL_TIME_START = "2015-01-01"

function expandDates(expression: string): string {
  const now = new Date()
  return expression
    .replace(/\$daysAgo\((\d+)\)/g, (_, n) => {
      const d = new Date(now)
      d.setUTCDate(d.getUTCDate() - Number(n))
      return dateLiteral(d)
    })
    .replace(/\$today/g, dateLiteral(now))
}

function substitute(q: SpecQuery & { kind: "analytics" }, range: DateRange, prior: DateRange, granularity: Granularity): AnalyticsQuery {
  const td = (q.query.timeDimensions ?? []).map((t) => ({
    dimension: t.dimension,
    ...(t.granularity ? { granularity: t.granularity === "$granularity" ? granularity : t.granularity } : {}),
    ...(t.dateRange ? { dateRange: t.dateRange === "$range" ? range : t.dateRange === "$priorRange" ? prior : t.dateRange } : {}),
  }))
  return { ...q.query, timeDimensions: td }
}

export async function runSpec(spec: ReportSpec, ctx: RunContext): Promise<RunOutput> {
  const key = ctx.dateRangeKey
  const today = new Date().toISOString().slice(0, 10)
  const range: DateRange = getDateRange(key) ?? [ALL_TIME_START, today]
  const prior = getPriorRange(range)
  const granularity = getGranularity(key)

  const results: Record<string, QueryResult> = {}
  await Promise.all(
    spec.queries.map(async (q) => {
      const started = Date.now()
      try {
        if (q.kind === "analytics") {
          const rows = await queryAnalytics(ctx.environment, ctx.authHeader, substitute(q, range, prior, granularity))
          if (q.resolveTitles && rows.length) {
            const ids = rows.map((r) => str(r[q.resolveTitles!])).filter(Boolean)
            const cards = await fetchRecordCards(ctx.client, ids)
            for (const r of rows) {
              const c: RecordCard | undefined = cards.get(str(r[q.resolveTitles!]))
              if (c && !c.unavailable) {
                r._title = c.title
                r._thumbnail = c.thumbnail ?? null
                r._contentType = c.contentType ?? null
                r._link = `https://${ctx.environment}.dam.aprimo.com/dam/contentitems/${c.key}`
              } else {
                r._title = null
                r._unavailable = c?.unavailable ?? "error"
              }
            }
          }
          results[q.id] = { id: q.id, kind: q.kind, rows, ms: Date.now() - started }
        } else if (q.kind === "search-count") {
          const count = await countRecords(ctx.client, expandDates(q.expression))
          results[q.id] = { id: q.id, kind: q.kind, count, ms: Date.now() - started }
        } else if (q.kind === "content-type-counts") {
          const types = await listContentTypes(ctx.client)
          const extra = q.extraExpression ? ` AND (${expandDates(q.extraExpression)})` : ""
          const counts = await runThrottled(types.map((t) => () => countRecords(ctx.client, `ContentType = '${escapeExpr(t.name)}'${extra}`)), 4)
          results[q.id] = {
            id: q.id,
            kind: q.kind,
            rows: types.map((t, i) => ({ contentType: t.name, count: counts[i].status === "fulfilled" ? counts[i].value : null })),
            ms: Date.now() - started,
          }
        } else if (q.kind === "search") {
          const { items, totalCount } = await searchRecordCards(ctx.client, expandDates(q.expression), q.pageSize ?? 25)
          results[q.id] = {
            id: q.id,
            kind: q.kind,
            count: totalCount,
            rows: items.map((c) => ({ id: c.key, title: c.title, contentType: c.contentType, status: c.status, createdOn: c.createdOn, modifiedOn: c.modifiedOn, thumbnail: c.thumbnail ?? null, fileName: c.fileName ?? null, fileSize: c.fileSize ?? null, link: `https://${ctx.environment}.dam.aprimo.com/dam/contentitems/${c.key}` })),
            ms: Date.now() - started,
          }
        }
      } catch (e) {
        results[q.id] = { id: q.id, kind: q.kind, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }
      }
    }),
  )
  return { results, range, priorRange: prior, granularity, dateRangeKey: key, environment: ctx.environment, refreshedAt: new Date().toISOString() }
}

/** Light validation so a stored spec can't ask for anything outside the read-only surface. */
export function validateSpec(spec: unknown): spec is ReportSpec {
  if (!spec || typeof spec !== "object") return false
  const s = spec as ReportSpec
  if (s.version !== 1 || !Array.isArray(s.queries) || s.queries.length > 20) return false
  return s.queries.every((q) => {
    if (!q || typeof q.id !== "string") return false
    if (q.kind === "analytics") return !!q.query && typeof q.query === "object" && (q.query.limit ?? 0) <= 5000
    if (q.kind === "search-count" || q.kind === "search") return typeof q.expression === "string" && q.expression.length < 2000
    if (q.kind === "content-type-counts") return q.extraExpression === undefined || (typeof q.extraExpression === "string" && q.extraExpression.length < 500)
    return false
  })
}
