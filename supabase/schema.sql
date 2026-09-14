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
