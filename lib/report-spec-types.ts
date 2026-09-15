// Shared types and validation for saved-report specs. No "use client" so the
// chat route (server) and the panel (client) both import from here.

import type { AnalyticsQuery, DateRange, DateRangeKey, Granularity } from "@/lib/analytics"

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
