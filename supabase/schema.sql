-- Report Labs persistence. All access is server-side with the service role;
-- RLS is enabled with no policies so the anon/authenticated roles see nothing.

create table if not exists saved_questions (
  id           uuid primary key default gen_random_uuid(),
  environment  text not null,
  user_id      text not null,
  user_login   text,
  question     text not null,
  title        text,
  report_id    text,
  date_range   text,
  pinned       boolean not null default false,
  use_count    integer not null default 0,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists saved_questions_user_idx on saved_questions (environment, user_id, pinned desc, last_used_at desc nulls last, created_at desc);
alter table saved_questions enable row level security;

create table if not exists assistant_log (
  id                uuid primary key default gen_random_uuid(),
  environment       text not null,
  user_id           text not null,
  user_login        text,
  question          text not null,
  report_id         text,
  date_range        text,
  mcp_enabled       boolean not null default false,
  tools             jsonb not null default '[]'::jsonb,
  answer_chars      integer,
  input_tokens      integer,
  output_tokens     integer,
  cache_read_tokens integer,
  duration_ms       integer,
  error             text,
  created_at        timestamptz not null default now()
);
create index if not exists assistant_log_env_idx on assistant_log (environment, created_at desc);
alter table assistant_log enable row level security;

-- Saved reports: a declarative data spec plus, for rich dashboards, an HTML
-- view that only ever receives data from the host page (sandboxed, no network).
create table if not exists saved_reports (
  id           uuid primary key default gen_random_uuid(),
  environment  text not null,
  user_id      text not null,
  user_login   text,
  title        text not null,
  description  text,
  view         text not null default 'html' check (view in ('html', 'standard')),
  spec         jsonb not null,
  html         text,
  source       text not null default 'assistant',
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists saved_reports_user_idx on saved_reports (environment, user_id, pinned desc, updated_at desc);
alter table saved_reports enable row level security;

-- Question intelligence: each assistant question is classified after the fact
-- (theme, topics, whether a dashboard was wanted, which standard report covers
-- it) so admins can see what people ask for and where the gaps are.
alter table assistant_log add column if not exists intent text;
alter table assistant_log add column if not exists topics jsonb;
alter table assistant_log add column if not exists wants_dashboard boolean;
alter table assistant_log add column if not exists matched_report text;
alter table assistant_log add column if not exists classified_at timestamptz;

-- Admin insights: Claude's periodic read of the question log, kept so the
-- admin page loads instantly and the history of recommendations is retained.
create table if not exists admin_insights (
  id           uuid primary key default gen_random_uuid(),
  environment  text not null,
  generated_by text,
  window_days  integer,
  stats        jsonb,
  markdown     text not null,
  created_at   timestamptz not null default now()
);
create index if not exists admin_insights_env_idx on admin_insights (environment, created_at desc);
alter table admin_insights enable row level security;

-- Sharing: a saved report is private to its owner or visible to everyone in
-- the same Aprimo environment. Viewers run it as themselves, so their own
-- permissions apply; only the owner can edit, pin, share, or delete it.
alter table saved_reports add column if not exists visibility text not null default 'private' check (visibility in ('private', 'environment'));
create index if not exists saved_reports_shared_idx on saved_reports (environment, visibility, updated_at desc);
