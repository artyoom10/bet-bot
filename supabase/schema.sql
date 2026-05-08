create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tg_id text not null unique,
  username text,
  first_name text,
  last_name text,
  language_code text,
  client_status text not null default 'Железо',
  is_blocked boolean not null default false,
  block_reason text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  currency text not null default 'DEMO',
  balance numeric(18, 2) not null default 1000,
  withdrawable_balance numeric(18, 2) not null default 0,
  locked_balance numeric(18, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, currency)
);

create table if not exists wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wallet_id uuid not null references wallets(id) on delete cascade,
  type text not null,
  amount numeric(18, 2) not null,
  balance_before numeric(18, 2),
  balance_after numeric(18, 2),
  related_bet_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists sports (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'odds_api',
  sport_key text not null unique,
  title_en text not null,
  title_ru text,
  group_name text,
  logo_url text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ru text not null,
  short_name_ru text,
  slug text unique,
  logo_url text,
  country text,
  sport_type text not null default 'soccer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists team_source_aliases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  source text not null default 'odds_api',
  sport_key text,
  raw_name text not null,
  created_at timestamptz not null default now(),
  unique(source, sport_key, raw_name)
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'odds_api',
  external_event_id text not null,
  sport_key text not null references sports(sport_key) on delete cascade,
  home_team_id uuid references teams(id) on delete set null,
  away_team_id uuid references teams(id) on delete set null,
  home_team_raw text not null,
  away_team_raw text not null,
  commence_time timestamptz not null,
  status text not null default 'upcoming',
  raw_payload jsonb,
  last_odds_sync_at timestamptz,
  home_score integer,
  away_score integer,
  result_winner text,
  result_note text,
  result_payload jsonb,
  result_last_update timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source, external_event_id)
);

create table if not exists bookmakers (
  id uuid primary key default gen_random_uuid(),
  bookmaker_key text not null unique,
  title text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists odds_current (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  bookmaker_key text not null references bookmakers(bookmaker_key),
  market_key text not null default 'h2h',
  selection_key text not null,
  selection_name_raw text not null,
  selection_name_ru text,
  price numeric(10, 2) not null,
  api_last_update timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, bookmaker_key, market_key, selection_key)
);

create table if not exists odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  bookmaker_key text not null,
  market_key text not null default 'h2h',
  selection_key text not null,
  selection_name_raw text not null,
  price numeric(10, 2) not null,
  api_last_update timestamptz,
  captured_at timestamptz not null default now()
);

create table if not exists bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  tg_id text not null,
  amount numeric(18, 2) not null,
  total_odds numeric(10, 2) not null,
  possible_win numeric(18, 2) not null,
  status text not null default 'pending',
  bet_type text not null default 'single',
  payout numeric(18, 2),
  settlement_note text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create table if not exists bet_selections (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null references bets(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  bookmaker_key text,
  market_key text not null default 'h2h',
  selection_key text not null,
  selection_name_raw text not null,
  selection_name_ru text,
  price numeric(10, 2) not null,
  event_name_ru text not null,
  home_team_name_ru text,
  away_team_name_ru text,
  commence_time timestamptz,
  result_status text not null default 'pending',
  created_at timestamptz not null default now()
);

do $$
begin
  alter table wallet_transactions drop constraint if exists wallet_transactions_related_bet_id_fkey;
  alter table wallet_transactions
    add constraint wallet_transactions_related_bet_id_fkey
    foreign key (related_bet_id) references bets(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create table if not exists user_league_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  threshold integer not null,
  title text not null,
  stars_amount numeric(18, 2) not null default 0,
  wheel_type text,
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, threshold)
);

create table if not exists fortune_wheel_spins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wheel_type text not null,
  source_threshold integer,
  status text not null default 'available',
  prize_amount numeric(18, 2),
  created_at timestamptz not null default now(),
  spun_at timestamptz
);

create table if not exists daily_login_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  reward_date date not null,
  streak_day integer not null,
  stars_amount numeric(18, 2) not null,
  created_at timestamptz not null default now(),
  unique(user_id, reward_date)
);

create table if not exists telegram_updates (
  update_id bigint primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'odds_api',
  sport_key text,
  status text not null default 'started',
  triggered_by text,
  triggered_by_user_id uuid references users(id) on delete set null,
  request_url text,
  events_count integer default 0,
  odds_count integer default 0,
  bookmakers_count integer default 0,
  quota_remaining integer,
  quota_used integer,
  quota_last integer,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists odds_api_usage (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'odds_api',
  quota_remaining integer,
  quota_used integer,
  quota_last integer,
  fetched_from text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists admin_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references users(id) on delete set null,
  admin_tg_id text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists settlement_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'odds_api_scores',
  status text not null default 'started',
  triggered_by text,
  triggered_by_user_id uuid references users(id) on delete set null,
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

create index if not exists idx_users_tg_id on users(tg_id);
create index if not exists idx_wallets_user_id on wallets(user_id);
create index if not exists idx_wallet_transactions_user_created on wallet_transactions(user_id, created_at desc);
create index if not exists idx_sports_enabled on sports(is_enabled);
create index if not exists idx_events_sport_time on events(sport_key, commence_time);
create index if not exists idx_events_status_time on events(status, commence_time);
create index if not exists idx_events_external on events(source, external_event_id);
create index if not exists idx_team_alias_raw on team_source_aliases(source, sport_key, raw_name);
create index if not exists idx_odds_current_event on odds_current(event_id);
create index if not exists idx_odds_current_event_bookmaker on odds_current(event_id, bookmaker_key);
create index if not exists idx_odds_snapshots_event_captured on odds_snapshots(event_id, captured_at desc);
create index if not exists idx_bets_user_created on bets(user_id, created_at desc);
create index if not exists idx_bets_status on bets(status);
create index if not exists idx_bet_selections_bet_id on bet_selections(bet_id);
create index if not exists idx_wallet_transactions_related_bet on wallet_transactions(related_bet_id);
create index if not exists idx_user_league_rewards_user on user_league_rewards(user_id, threshold);
create index if not exists idx_fortune_wheel_spins_user on fortune_wheel_spins(user_id, status, created_at desc);
create index if not exists idx_daily_login_rewards_user_date on daily_login_rewards(user_id, reward_date desc);
create index if not exists idx_sync_runs_started_at on sync_runs(started_at desc);
create index if not exists idx_odds_api_usage_created_at on odds_api_usage(created_at desc);
create index if not exists idx_admin_logs_created_at on admin_logs(created_at desc);
create index if not exists idx_settlement_runs_started_at on settlement_runs(started_at desc);
