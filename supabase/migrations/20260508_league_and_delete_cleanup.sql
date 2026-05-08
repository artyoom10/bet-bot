-- League progression, one-time rewards, wheel spins and safer cascade deletion.
-- Run in Supabase SQL editor after the previous cascade/logo migrations.

alter table users alter column client_status set default 'Железо';

update users
set client_status = 'Железо'
where client_status is null
   or client_status in ('new', 'active', 'vip', 'test', 'restricted', 'suspended', 'telegram_only', 'Новичок', 'Игрок', 'Аналитик', 'Рисковый', 'Профи', 'Акула', 'Магнат', 'Легенда', 'Босс');

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

create index if not exists idx_user_league_rewards_user on user_league_rewards(user_id, threshold);
create index if not exists idx_fortune_wheel_spins_user on fortune_wheel_spins(user_id, status, created_at desc);

create table if not exists daily_login_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  reward_date date not null,
  streak_day integer not null,
  stars_amount numeric(18, 2) not null,
  created_at timestamptz not null default now(),
  unique(user_id, reward_date)
);

create index if not exists idx_daily_login_rewards_user_date on daily_login_rewards(user_id, reward_date desc);

alter table wallets drop constraint if exists wallets_user_id_fkey;
alter table wallets
  add constraint wallets_user_id_fkey
  foreign key (user_id) references users(id) on delete cascade;

alter table wallet_transactions drop constraint if exists wallet_transactions_user_id_fkey;
alter table wallet_transactions
  add constraint wallet_transactions_user_id_fkey
  foreign key (user_id) references users(id) on delete cascade;

alter table wallet_transactions drop constraint if exists wallet_transactions_wallet_id_fkey;
alter table wallet_transactions
  add constraint wallet_transactions_wallet_id_fkey
  foreign key (wallet_id) references wallets(id) on delete cascade;

update wallet_transactions wt
set related_bet_id = null
where related_bet_id is not null
  and not exists (
    select 1
    from bets b
    where b.id = wt.related_bet_id
  );

alter table wallet_transactions drop constraint if exists wallet_transactions_related_bet_id_fkey;
alter table wallet_transactions
  add constraint wallet_transactions_related_bet_id_fkey
  foreign key (related_bet_id) references bets(id) on delete set null;

create index if not exists idx_wallet_transactions_related_bet on wallet_transactions(related_bet_id);

alter table events drop constraint if exists events_sport_key_fkey;
alter table events
  add constraint events_sport_key_fkey
  foreign key (sport_key) references sports(sport_key) on delete cascade;

alter table events drop constraint if exists events_home_team_id_fkey;
alter table events
  add constraint events_home_team_id_fkey
  foreign key (home_team_id) references teams(id) on delete set null;

alter table events drop constraint if exists events_away_team_id_fkey;
alter table events
  add constraint events_away_team_id_fkey
  foreign key (away_team_id) references teams(id) on delete set null;

alter table odds_current drop constraint if exists odds_current_event_id_fkey;
alter table odds_current
  add constraint odds_current_event_id_fkey
  foreign key (event_id) references events(id) on delete cascade;

alter table odds_snapshots drop constraint if exists odds_snapshots_event_id_fkey;
alter table odds_snapshots
  add constraint odds_snapshots_event_id_fkey
  foreign key (event_id) references events(id) on delete cascade;

alter table bet_selections drop constraint if exists bet_selections_bet_id_fkey;
alter table bet_selections
  add constraint bet_selections_bet_id_fkey
  foreign key (bet_id) references bets(id) on delete cascade;

alter table bet_selections drop constraint if exists bet_selections_event_id_fkey;
alter table bet_selections
  add constraint bet_selections_event_id_fkey
  foreign key (event_id) references events(id) on delete set null;

alter table bets drop constraint if exists bets_user_id_fkey;
alter table bets
  add constraint bets_user_id_fkey
  foreign key (user_id) references users(id) on delete cascade;

alter table admin_logs drop constraint if exists admin_logs_admin_user_id_fkey;
alter table admin_logs
  add constraint admin_logs_admin_user_id_fkey
  foreign key (admin_user_id) references users(id) on delete set null;

alter table sync_runs drop constraint if exists sync_runs_triggered_by_user_id_fkey;
alter table sync_runs
  add constraint sync_runs_triggered_by_user_id_fkey
  foreign key (triggered_by_user_id) references users(id) on delete set null;

alter table settlement_runs drop constraint if exists settlement_runs_triggered_by_user_id_fkey;
alter table settlement_runs
  add constraint settlement_runs_triggered_by_user_id_fkey
  foreign key (triggered_by_user_id) references users(id) on delete set null;
