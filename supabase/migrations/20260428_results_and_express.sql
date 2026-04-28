alter table events add column if not exists home_score integer;
alter table events add column if not exists away_score integer;
alter table events add column if not exists result_winner text;
alter table events add column if not exists result_payload jsonb;
alter table events add column if not exists result_last_update timestamptz;
alter table events add column if not exists settled_at timestamptz;

alter table teams add column if not exists logo_url text;

alter table bets add column if not exists bet_type text not null default 'single';
alter table bets add column if not exists payout numeric(18, 2);
alter table bets add column if not exists settlement_note text;
alter table bets add column if not exists settled_at timestamptz;

alter table bet_selections add column if not exists result_status text not null default 'pending';

create table if not exists settlement_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'odds_api_scores',
  status text not null default 'started',
  triggered_by text,
  triggered_by_user_id uuid references users(id),
  events_checked integer default 0,
  events_completed integer default 0,
  bets_settled integer default 0,
  quota_remaining integer,
  quota_used integer,
  quota_last integer,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_settlement_runs_started_at on settlement_runs(started_at desc);
