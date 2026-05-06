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
- `vercel.json`: Vercel routing/build config.

## Основные модули

- `lib/supabase_client.py`: тонкий REST client для Supabase tables.
- `lib/telegram_auth.py`: валидация Telegram initData.
- `lib/users.py`: создание и синхронизация пользователя из Telegram.
- `lib/admin_auth.py`: проверка админа через `ADMIN_TELEGRAM_IDS` или поле пользователя.
- `lib/admin_users.py`: CRUD пользователей, балансы и статусы.
- `lib/admin_aliases.py`: команды, алиасы, русские названия и применение алиасов к событиям.
- `lib/events.py`: выдача линии для Mini App, форматирование команд, markets и outcomes.
- `lib/bets.py`: валидация купона, создание single/express ставок, история ставок.
- `lib/odds_api.py`: HTTP calls к The Odds API; для хоккея регионы берутся из `ODDS_API_HOCKEY_REGIONS`, для остальных видов спорта из `ODDS_API_REGIONS`.
- `lib/odds_sync.py`: sync sports/events/odds, detailed event markets, sync_runs debug; нормализует базовые и detailed markets в русские названия исходов.
- `lib/settlement.py`: sync scores, ручной результат, расчёт pending ставок.
- `static/app.js`: весь frontend state, Telegram Mini App UI, админка, купон, история.

## Поток данных

1. Telegram открывает Mini App и передаёт `initData`.
2. Frontend отправляет `X-Telegram-Init-Data` в API requests.
3. Backend валидирует initData, создаёт или обновляет пользователя в Supabase.
4. `/api/sports` и `/api/events` читают upcoming events и odds из Supabase.
5. Админ запускает `/api/admin/sync-odds`; frontend может делать один общий sync или отдельные запросы по турнирам (`sport_keys: ["soccer_epl"]`, `["icehockey_nhl"]` и т.д.).
6. Backend получает events/odds из The Odds API и пишет `events`, `odds_current`, `odds_snapshots`, `sync_runs`; каждый ответ возвращает `debug`, masked `request_url`, quota headers и последние строки из Supabase.
7. Пользователь выбирает исходы; frontend отправляет `/api/bets` с amount и selections.
8. `lib/bets.py` валидирует odds, списывает demo-баланс, создаёт `bets`, `bet_selections`, `wallet_transactions`.
9. Админ запускает scores/manual settlement; `lib/settlement.py` обновляет events, bet selections, bets и wallet.
10. Frontend обновляет историю ставок и баланс через `/api/bets` и `/api/me`.

## Ограничения

- Только demo-баланс, без реальных денег.
- Только prematch; live-ставок нет.
- Backend secrets не должны попадать на frontend.
- `.env` не редактировать и не печатать.
- Supabase service role key используется только на backend.
- The Odds API расходует credits; `/scores` с `daysFrom` дороже.
- Detailed markets по событию могут расходовать дополнительные credits.
- Базовый sync запрашивает `h2h,spreads,totals`; дополнительные рынки по событию подтягиваются отдельной кнопкой “Получить рынок”.
- Поддерживаемые базовые турниры сейчас: `soccer_epl`, `soccer_russia_premier_league`, `soccer_spain_la_liga`, `soccer_uefa_champs_league`, `icehockey_nhl`.

## Известные слабые места

- Долгий sync может упереться в лимиты Vercel Function timeout.
- Нет полноценной фоновой очереди для sync/settlement.
- Списание баланса и создание ставки через Supabase REST не является атомарной Postgres transaction.
- Settlement защищён проверкой pending status, но при параллельных запусках остаётся риск гонок.
- The Odds API может не вернуть odds/scores по конкретной лиге, региону или рынку.
- NHL чувствителен к `regions`; для него используется отдельная переменная `ODDS_API_HOCKEY_REGIONS=us,eu`.
- TODO: добавить server-side pagination для больших списков событий, ставок и пользователей.
