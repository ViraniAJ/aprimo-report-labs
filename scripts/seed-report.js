#!/usr/bin/env node
// Seeds (or replaces) a saved report for a user directly in Postgres.
// Usage: node scripts/seed-report.js <environment> <damUserId> <login> <samples/name>
// Reads samples/<name>.html and samples/<name>.spec.json. Requires
// POSTGRES_URL_NON_POOLING in the environment (e.g. from .env.local via dotenv).
const fs = require("fs")
const path = require("path")
const { Client } = require("pg")

const [environment, userId, login, sample, titleArg] = process.argv.slice(2)
if (!environment || !userId || !login || !sample) {
  console.error("usage: seed-report.js <environment> <damUserId> <login> <samples/name> [title]")
  process.exit(1)
}
const html = fs.readFileSync(path.resolve(`${sample}.html`), "utf8")
const spec = JSON.parse(fs.readFileSync(path.resolve(`${sample}.spec.json`), "utf8"))
const title = titleArg || spec.title || path.basename(sample)
const description = spec.description || null

;(async () => {
  const c = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query("delete from saved_reports where environment=$1 and user_id=$2 and title=$3", [environment, userId.toLowerCase(), title])
  const r = await c.query(
    "insert into saved_reports (environment, user_id, user_login, title, description, view, spec, html, source, pinned) values ($1,$2,$3,$4,$5,'html',$6,$7,'seed',true) returning id",
    [environment, userId.toLowerCase(), login, title, description, JSON.stringify(spec), html],
  )
  console.log(`seeded "${title}" for ${login}@${environment} → ${r.rows[0].id} (${html.length} chars html, ${spec.queries.length} queries)`)
  await c.end()
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
