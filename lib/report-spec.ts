"use client"

// The data plane for saved reports. A report is a declarative spec of named
// queries; running it as the signed-in user produces a results object that is
// handed to the view (the app's components, or a sandboxed HTML page). The
// view never touches Aprimo itself, so a report can be refreshed at any time.

import { queryAnalytics, queryRanked, getDateRange, getPriorRange, getGranularity, str, TITLE_DIM, TYPE_DIM, type AnalyticsQuery, type DateRange, type DateRangeKey, type Granularity } from "@/lib/analytics"
import { countRecords, searchRecordCards, fetchRecordCards, listContentTypes, runThrottled, escapeExpr, dateLiteral, type AprimoClient, type RecordCard } from "@/lib/core"

export type { SpecQuery, ReportSpec, QueryResult } from "@/lib/report-spec-types"
export { validateSpec } from "@/lib/report-spec-types"
import type { SpecQuery, ReportSpec, QueryResult } from "@/lib/report-spec-types"

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
          const built = substitute(q, range, prior, granularity)
          let rows
          if (q.resolveTitles) {
            // Titles from the analytics join when available; thumbnails for the top rows via the Core API.
            const ranked = await queryRanked(ctx.environment, ctx.authHeader, built)
            rows = ranked.rows
            const ids = rows.map((r) => str(r[q.resolveTitles!])).filter(Boolean)
            const cards = await fetchRecordCards(ctx.client, ids.slice(0, ranked.joined ? 25 : ids.length))
            for (const r of rows) {
              const raw = str(r[q.resolveTitles!])
              const c: RecordCard | undefined = cards.get(raw)
              const joinedTitle = ranked.joined ? str(r[TITLE_DIM]).trim() : ""
              const key = raw.replace(/-/g, "").toLowerCase()
              if (joinedTitle || (c && !c.unavailable)) {
                r._title = joinedTitle || c!.title
                r._thumbnail = c?.thumbnail ?? null
                r._contentType = (ranked.joined ? str(r[TYPE_DIM]) : "") || c?.contentType || null
                r._link = `https://${ctx.environment}.dam.aprimo.com/dam/contentitems/${key}`
              } else {
                r._title = null
                r._unavailable = c?.unavailable ?? (c ? "error" : "not-fetched")
              }
            }
          } else {
            rows = await queryAnalytics(ctx.environment, ctx.authHeader, built)
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

