# Report Labs

Live reporting and a natural-language assistant that extend Aprimo DAM. A standalone Next.js app that shares its architecture with [Aprimo Editor Tools](https://github.com/Aprimo-Connect/aprimo-editor-tools): PKCE login against Aprimo, the [aprimo-js](https://github.com/Timw255/aprimo-js) SDK for every API call, and Vercel for hosting. Nothing is stored; every query runs as the signed-in user.

> Community project, not maintained or supported by Aprimo.

## What's inside

**Twelve standard reports** over the Analytics and Core APIs, with a global date range, optional collection scope, and Excel/CSV export on every table.

| Group | Reports |
|-------|---------|
| Engagement | Executive Overview · Asset Performance · Zero Engagement · User Adoption · Public Link Traffic · Format Demand · Video Performance |
| Library | Library Composition · Library Growth · Content Freshness · Duplicate Assets |
| Reference | Analytics Data Model |

**An assistant** that runs Claude with read-only tools (analytics schema and queries, record counts and search, title resolution, content types, collections), streams answers with tables and inline charts, and shows every query it ran.

## Setup

1. In Aprimo, create a registration under Settings → Registrations with grant type **Authorization Code with PKCE** and redirect URI `https://<your-site>/oauth/callback` (plus `http://localhost:3000/oauth/callback` for local work).
2. Copy `.env.local.example` to `.env.local` and set `NEXT_PUBLIC_APRIMO_ENVIRONMENT`, `NEXT_PUBLIC_APRIMO_CLIENT_ID`, and `APRIMO_CLIENT_SECRET`. The secret stays server-side.
3. Optionally set `ANTHROPIC_API_KEY` to enable the assistant.
4. `npm install` and `npm run dev`.

Deploy to Vercel with the same variables. Without the Aprimo variables, users add environments themselves in the Connect dialog.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_APRIMO_ENVIRONMENT` | Recommended | Aprimo subdomain, e.g. `acme` for acme.dam.aprimo.com |
| `NEXT_PUBLIC_APRIMO_CLIENT_ID` | Recommended | PKCE registration client id |
| `APRIMO_CLIENT_SECRET` | If the registration has one | Server-side only |
| `ANTHROPIC_API_KEY` | For the assistant | Server-side only |
| `REPORT_LABS_MODEL` | No | Defaults to `claude-opus-5` |
| `NEXT_PUBLIC_RECORD_LABEL_FIELD` | No | Internal field name used as the record label in rankings. Falls back to the record title, then the master file name |
| `NEXT_PUBLIC_EDITOR_TOOLS_URL` | No | Base URL of an Editor Tools deployment; adds a "Resolve in Editor Tools" link on the Duplicates report |

Duplicate Assets needs two global, indexed, single-line text fields named `_Checksum` and `_Filename`, populated by rule references (`<ref:record file="master" out="CRC32"/>` and `out="filename"`) that reset on master file change. The report explains this when the fields are missing.

## Layout

```
app/                 routes: / (reports), /oauth/callback, /api/aprimo/token, /api/chat
components/reports/  one file per report
components/report-labs/  shared report UI, charts, assistant panel
lib/                 analytics + core API helpers, report registry, export
context/             Aprimo connection context
```
