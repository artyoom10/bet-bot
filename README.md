# Demo Bet Mini App

Flask backend for a Telegram Mini App demo sportsbook with Supabase storage and admin tools inside the Mini App.

## Environment

Required for production:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_WEBAPP_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ODDS_API_KEY=
ODDS_API_REGIONS=eu
ODDS_API_HOCKEY_REGIONS=us,eu
ODDS_API_MARKETS=h2h,spreads,totals
ODDS_SYNC_BOOKMAKER_KEYS=pinnacle,onexbet,marathonbet
ODDS_SYNC_MAX_EVENTS=40
ADMIN_TELEGRAM_IDS=
DEBUG_ADMIN=0
```

`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, and `ODDS_API_KEY` are backend-only secrets.
`ODDS_API_REGIONS` can be expanded, for example `eu,uk`, if a league has events but no odds in the current region.
`ODDS_API_HOCKEY_REGIONS` is optional and defaults to `us,eu`; NHL odds are often available in `us`, so hockey sync uses this value instead of the football region list.
`ODDS_API_MARKETS` controls base sync markets. Keep it small for Vercel; use the admin “Получить рынок” action for detailed event markets.
`ODDS_SYNC_BOOKMAKER_KEYS` limits how many bookmakers are processed during normal sync. Use `all` only if your Vercel function timeout and Supabase quota can handle the larger write volume.
`ODDS_SYNC_MAX_EVENTS` caps how many nearest events one tournament sync writes. Set `0` only if your Vercel timeout can handle full long schedules.

## Supabase setup

Run these files in the Supabase SQL editor:

1. `supabase/schema.sql`
2. `supabase/seed.sql`

For an existing database, also run:

```sql
-- supabase/migrations/20260428_results_and_express.sql
-- supabase/migrations/20260507_sport_logos_and_result_note.sql
```

This adds result fields, payout fields, express settlement status, team/tournament logo support, hockey result notes, and `settlement_runs`.

## Admin endpoints

- `POST /api/admin/sync-odds`
- `POST /api/admin/refresh-odds-usage`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/events`
- `POST /api/admin/events/:id/fetch-markets`
- `GET /api/admin/bets`
- `POST /api/admin/bets/:id/manual-settlement`
- `DELETE /api/admin/bets/:id`
- `DELETE /api/admin/manual-sports/:sport_key`
- `GET /api/admin/aliases`
- `POST /api/admin/team-aliases`
- `PATCH /api/admin/teams/:id`
- `POST /api/admin/sync-scores`
- `POST /api/admin/settle-bets`
- `POST /api/admin/sync-scores-and-settle`
- `POST /api/admin/events/:id/manual-result`

The scores sync uses The Odds API `/scores` endpoint. With `daysFrom=3` it costs 2 credits; without `daysFrom` it costs 1 credit. Some leagues may return incomplete coverage, so the admin UI also has manual result entry.

## Local run

```powershell
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
flask --app app run --debug
```

## Vercel deploy

The production Vercel entrypoint is `api/index.py`, which imports the Flask app from root `app.py`.
`vercel.json` must not use legacy `builds`; it uses `functions` plus a rewrite to `/api/index`.

To force a fresh production deployment from this repository:

```powershell
npx vercel link
npx vercel pull --yes --environment=production
npx vercel deploy --prod --force
```

## Telegram webhook

```powershell
$BOT_TOKEN="your_bot_token"
$SECRET="your_webhook_secret"
$URL="https://your-vercel-domain.vercel.app/webhook"

Invoke-RestMethod -Uri "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" `
  -Method Post `
  -Body @{
    url = $URL
    secret_token = $SECRET
  }
```
