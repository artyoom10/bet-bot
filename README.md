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
```

`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, and `ODDS_API_KEY` are backend-only secrets.

## Supabase setup

Run these files in the Supabase SQL editor:

1. `supabase/schema.sql`
2. `supabase/seed.sql`

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
