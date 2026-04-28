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
ADMIN_TELEGRAM_IDS=
DEBUG_ADMIN=0
```

`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, and `ODDS_API_KEY` are backend-only secrets.

## Supabase setup

Run these files in the Supabase SQL editor:

1. `supabase/schema.sql`
2. `supabase/seed.sql`

For an existing database, also run:

```sql
-- supabase/migrations/20260428_results_and_express.sql
```

This adds result fields, payout fields, express settlement status, logo support, and `settlement_runs`.

## Admin endpoints

- `POST /api/admin/sync-odds`
- `POST /api/admin/refresh-odds-usage`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `GET /api/admin/events`
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
