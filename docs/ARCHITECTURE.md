# Architecture

## Назначение проекта

`bet-bot` — демо-букмекерка для Telegram Mini App. Приложение работает только с виртуальным demo-балансом, без реальных денег, платежей и вывода средств. Основной сценарий: пользователь открывает Mini App, смотрит prematch-линию, собирает купон и делает demo-ставку. Админ управляет пользователями, алиасами команд, ручными событиями, синхронизацией коэффициентов и расчётом результатов.

## Стек

- Backend: Flask `3.1.0`.
- Runtime/deploy: Vercel Python через `@vercel/python`.
- Frontend: server-rendered `templates/index.html` + vanilla JavaScript `static/app.js` + CSS `static/styles.css`.
- Database: Supabase Postgres через REST API.
- Auth: Telegram Mini App `initData`.
- Odds provider: The Odds API v4 (`/sports`, `/events`, `/odds`, `/events/{eventId}/markets`, `/events/{eventId}/odds`, `/scores`).
- Local Python dependencies: `Flask`, `python-dotenv`, `requests`.

## Структура папок

- `app.py`: Flask app, HTTP endpoints, Telegram webhook, admin endpoints, manual events helpers.
- `lib/`: прикладные backend-модули.
- `static/`: frontend JavaScript, CSS, logo.
- `templates/`: HTML shell Mini App.
- `supabase/`: schema, seed и SQL migration.
- `docs/`: handoff и архитектурные заметки для следующих сессий.
- `vercel.json`: Vercel rewrite config without legacy `builds`; all requests go to `/api/index`.
- `api/index.py`: Vercel Python Serverless Function entrypoint that imports Flask `app` from root `app.py`.

## Основные модули

- `lib/supabase_client.py`: тонкий REST client для Supabase tables; поддерживает `return_rows=False` для быстрых bulk write.
- `lib/telegram_auth.py`: валидация Telegram initData.
- `lib/users.py`: синхронизация существующего пользователя из Telegram; обычный неизвестный user не создаётся автоматически на входе.
- `lib/admin_auth.py`: проверка админа через `ADMIN_TELEGRAM_IDS` или поле пользователя без создания неизвестных non-env пользователей.
- `lib/admin_users.py`: CRUD пользователей, балансы, статусы и удаление.
- `lib/admin_aliases.py`: команды, алиасы, русские названия и применение алиасов к событиям.
- `lib/events.py`: выдача линии для Mini App, форматирование команд, markets и outcomes.
- `lib/bets.py`: валидация купона, создание single/express ставок, история ставок, ручной admin settlement и удаление ставки.
- `lib/odds_api.py`: HTTP calls к The Odds API; для хоккея регионы берутся из `ODDS_API_HOCKEY_REGIONS`, для остальных видов спорта из `ODDS_API_REGIONS`.
- `lib/odds_sync.py`: sync sports/events/odds, detailed event markets, sync_runs debug; нормализует базовые и detailed markets в русские названия исходов; fast sync пишет odds bulk upsert, не пишет snapshots, ограничивает ближайшие события через `ODDS_SYNC_MAX_EVENTS` и логирует в `admin_logs` компактный summary.
- `lib/settlement.py`: sync scores, ручной результат, `result_note` для ОТ/буллитов, расчёт pending ставок.
- `static/app.js`: весь frontend state, Telegram Mini App UI, админка, купон, история.

## Поток данных

1. Telegram открывает Mini App и передаёт `initData`.
2. Frontend отправляет `X-Telegram-Init-Data` в API requests.
3. Backend валидирует initData. Если user уже есть в Supabase, профиль обновляется; если user неизвестен и не входит в `ADMIN_TELEGRAM_IDS`, `/api/me` возвращает `access_denied`.
4. `/api/sports` и `/api/events` перед чтением линии запускают лёгкую очистку истёкших upcoming-событий: события без ставок удаляются, события со ставками закрываются статусом `closed`.
5. `/api/sports` и `/api/events` читают upcoming events и odds из Supabase.
6. Админ запускает `/api/admin/sync-odds`; frontend может делать один общий sync или отдельные запросы по турнирам (`sport_keys: ["soccer_epl"]`, `["icehockey_nhl"]` и т.д.).
7. Backend получает events/odds из The Odds API и пишет `events`, `bookmakers`, `odds_current`, `sync_runs`; odds/bookmakers пишутся bulk upsert с minimal response. Fast sync не пишет `odds_snapshots` и по умолчанию берёт ближайшие 40 событий турнира.
8. Пользователь выбирает исходы; frontend отправляет `/api/bets` с amount и selections.
9. `lib/bets.py` валидирует odds, списывает demo-баланс, создаёт `bets`, `bet_selections`, `wallet_transactions`.
10. Админ запускает scores/manual settlement; `lib/settlement.py` обновляет events, bet selections, bets и wallet. Для хоккея ручной расчёт может сохранить `result_note=ot|so`.
11. Frontend обновляет историю ставок и баланс через `/api/bets` и `/api/me`.

## Ограничения

- Только demo-баланс, без реальных денег.
- Только prematch; live-ставок нет.
- Backend secrets не должны попадать на frontend.
- `.env` не редактировать и не печатать.
- Supabase service role key используется только на backend.
- Обычный пользователь должен быть заранее создан админом. Env-админ может войти без профиля.
- The Odds API расходует credits; `/scores` с `daysFrom` дороже.
- Detailed markets по событию могут расходовать дополнительные credits.
- Fast sync ограничивает список обрабатываемых букмекеров через `ODDS_SYNC_BOOKMAKER_KEYS`; значение `all` обрабатывает всех букмекеров, но повышает риск timeout.
- `ODDS_API_MARKETS` задаёт базовые markets для общего sync; по умолчанию это `h2h,spreads,totals`.
- `ODDS_SYNC_MAX_EVENTS` ограничивает число ближайших событий на один sync турнира; значение `0` отключает лимит, но повышает риск timeout.
- Базовый sync запрашивает `h2h,spreads,totals`; дополнительные рынки по событию подтягиваются отдельной кнопкой “Получить рынок”.
- Поддерживаемые базовые турниры сейчас: `soccer_epl`, `soccer_russia_premier_league`, `soccer_spain_la_liga`, `soccer_uefa_champs_league`, `icehockey_nhl`.

## Известные слабые места

- Долгий sync может упереться в лимиты Vercel Function timeout.
- `vercel.json` задаёт `maxDuration: 300`, но реальный максимум зависит от тарифа Vercel.
- Нет полноценной фоновой очереди для sync/settlement.
- Fast sync не пишет `odds_snapshots`; истории движения коэффициентов сейчас нет.
- Списание баланса и создание ставки через Supabase REST не является атомарной Postgres transaction.
- Settlement защищён проверкой pending status, но при параллельных запусках остаётся риск гонок.
- Очистка истёкших событий выполняется синхронно внутри `/api/sports` и `/api/events`; при большом количестве старых событий это может добавить задержку первому запросу линии.
- The Odds API может не вернуть odds/scores по конкретной лиге, региону или рынку.
- NHL чувствителен к `regions`; для него используется отдельная переменная `ODDS_API_HOCKEY_REGIONS=us,eu`.
- `active=true` в `/sports` The Odds API означает доступность спорта/лиги для запросов; `has_outrights=false` означает отсутствие futures/outrights рынков, а не запрет обычных event odds.
- TODO: добавить server-side pagination для больших списков событий, ставок и пользователей.

## Админские удаления

- Удаление ручного соревнования выполняется только для `sports.source='manual'` или sport keys с префиксом `manual_`. Backend обрабатывает все события такого sport key: события без ставок удаляются, события со связанными ставками отменяются и рассчитываются как refund, после чего соревнование удаляется или скрывается через `is_enabled=false`, если физически удалить связанные события нельзя.
- Удаление пользователя сначала пытается физически удалить строку `users` и связанные cascade-данные. Если Supabase/Postgres не разрешает delete из-за внешних ссылок, профиль переводится в tombstone `tg_id='deleted:*'`, блокируется и скрывается из админского списка; старый Telegram ID после этого не проходит клубный доступ.
