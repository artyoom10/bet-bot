# Demo Bet Flask Mini App

Flask-заглушка для первого backend-деплоя Telegram Mini App.

## Локальный запуск

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
flask --app app run --debug
```

## Переменные окружения

Для деплоя создай переменные:

```bash
APP_NAME=Demo Bet
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-public-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
TELEGRAM_BOT_USERNAME=your_bot_username
TELEGRAM_BOT_TOKEN=token-from-botfather
TELEGRAM_WEBHOOK_SECRET=random-long-secret
```

`SUPABASE_SERVICE_ROLE_KEY` и `TELEGRAM_BOT_TOKEN` должны быть только на backend. Их нельзя отдавать во frontend.

## Маршруты

- `/` — Telegram Mini App.
- `/health` — проверка деплоя.
- `/api/me` — демо профиль и баланс.
- `/api/events` — демо линия событий.
- `/api/bets` — прием демо ставки.
- `/telegram/webhook` — заглушка webhook Telegram.

## Telegram

После деплоя укажи HTTPS URL приложения в BotFather через `/newapp`.

Webhook позже можно выставить так:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" ^
  -d "url=https://your-domain.com/telegram/webhook" ^
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```
