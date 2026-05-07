alter table sports add column if not exists logo_url text;
alter table teams add column if not exists logo_url text;
alter table events add column if not exists result_note text;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where n.nspname = 'public' and t.relname = 'events' and c.contype = 'f' and a.attname = 'sport_key'
  loop
    execute format('alter table public.events drop constraint %I', constraint_name);
  end loop;
end $$;

alter table events
  add constraint events_sport_key_fkey
  foreign key (sport_key)
  references sports(sport_key)
  on delete cascade;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where n.nspname = 'public' and t.relname = 'events' and c.contype = 'f' and a.attname = 'home_team_id'
  loop
    execute format('alter table public.events drop constraint %I', constraint_name);
  end loop;
end $$;

alter table events
  add constraint events_home_team_id_fkey
  foreign key (home_team_id)
  references teams(id)
  on delete set null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where n.nspname = 'public' and t.relname = 'events' and c.contype = 'f' and a.attname = 'away_team_id'
  loop
    execute format('alter table public.events drop constraint %I', constraint_name);
  end loop;
end $$;

alter table events
  add constraint events_away_team_id_fkey
  foreign key (away_team_id)
  references teams(id)
  on delete set null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where n.nspname = 'public' and t.relname = 'bet_selections' and c.contype = 'f' and a.attname = 'event_id'
  loop
    execute format('alter table public.bet_selections drop constraint %I', constraint_name);
  end loop;
end $$;

alter table bet_selections
  add constraint bet_selections_event_id_fkey
  foreign key (event_id)
  references events(id)
  on delete set null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where n.nspname = 'public' and t.relname = 'sync_runs' and c.contype = 'f' and a.attname = 'triggered_by_user_id'
  loop
    execute format('alter table public.sync_runs drop constraint %I', constraint_name);
  end loop;
end $$;

alter table sync_runs
  add constraint sync_runs_triggered_by_user_id_fkey
  foreign key (triggered_by_user_id)
  references users(id)
  on delete set null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where n.nspname = 'public' and t.relname = 'admin_logs' and c.contype = 'f' and a.attname = 'admin_user_id'
  loop
    execute format('alter table public.admin_logs drop constraint %I', constraint_name);
  end loop;
end $$;

alter table admin_logs
  add constraint admin_logs_admin_user_id_fkey
  foreign key (admin_user_id)
  references users(id)
  on delete set null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where n.nspname = 'public' and t.relname = 'settlement_runs' and c.contype = 'f' and a.attname = 'triggered_by_user_id'
  loop
    execute format('alter table public.settlement_runs drop constraint %I', constraint_name);
  end loop;
end $$;

alter table settlement_runs
  add constraint settlement_runs_triggered_by_user_id_fkey
  foreign key (triggered_by_user_id)
  references users(id)
  on delete set null;
