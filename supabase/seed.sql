insert into sports (sport_key, title_en, title_ru, group_name)
values
  ('soccer_epl', 'EPL', 'Английская Премьер-лига', 'Soccer'),
  ('soccer_russia_premier_league', 'Premier League - Russia', 'Российская Премьер-Лига', 'Soccer'),
  ('soccer_spain_la_liga', 'La Liga - Spain', 'Ла Лига', 'Soccer'),
  ('soccer_uefa_champs_league', 'UEFA Champions League', 'Лига чемпионов', 'Soccer'),
  ('icehockey_nhl', 'NHL', 'НХЛ', 'Ice Hockey')
on conflict (sport_key) do update set
  title_en = excluded.title_en,
  title_ru = excluded.title_ru,
  group_name = excluded.group_name,
  updated_at = now();

insert into bookmakers (bookmaker_key, title)
values
  ('pinnacle', 'Pinnacle'),
  ('onexbet', '1xBet'),
  ('marathonbet', 'Marathonbet')
on conflict (bookmaker_key) do update set
  title = excluded.title,
  updated_at = now();
