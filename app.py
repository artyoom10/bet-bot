import hashlib
import hmac
import json
import os
from urllib.parse import parse_qsl

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from supabase import Client, create_client

load_dotenv()


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["APP_NAME"] = os.getenv("APP_NAME", "Demo Bet")

    supabase = get_supabase_client()

    @app.get("/")
    def index():
        return render_template(
            "index.html",
            app_name=app.config["APP_NAME"],
            telegram_bot_username=os.getenv("TELEGRAM_BOT_USERNAME", ""),
        )

    @app.get("/health")
    def health():
        return jsonify({"ok": True, "service": app.config["APP_NAME"], "version": "0.1.1"})

    @app.get("/api/me")
    def me():
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        telegram_user = parse_telegram_user(init_data)

        if os.getenv("TELEGRAM_BOT_TOKEN") and not verify_telegram_init_data(init_data):
            return jsonify({"error": "invalid_telegram_init_data"}), 401

        return jsonify(
            {
                "user": telegram_user or {"first_name": "Demo", "username": "guest"},
                "balance": 10000,
                "currency": "RUB",
                "supabase": bool(supabase),
            }
        )

    @app.get("/api/events")
    def events():
        return jsonify(
            [
                {
                    "id": "football-1",
                    "league": "Футбол",
                    "title": "Москва - Петербург",
                    "time": "Сегодня, 20:30",
                    "odds": {"home": 1.92, "draw": 3.35, "away": 4.1},
                },
                {
                    "id": "tennis-1",
                    "league": "Теннис",
                    "title": "Иванов - Смирнов",
                    "time": "Завтра, 15:00",
                    "odds": {"home": 1.68, "away": 2.24},
                },
                {
                    "id": "basket-1",
                    "league": "Баскетбол",
                    "title": "North Stars - Red Fox",
                    "time": "Пт, 19:10",
                    "odds": {"home": 2.05, "away": 1.78},
                },
            ]
        )

    @app.post("/api/bets")
    def place_bet():
        payload = request.get_json(silent=True) or {}
        stake = int(payload.get("stake", 0))

        if stake <= 0:
            return jsonify({"error": "stake_must_be_positive"}), 400

        return jsonify(
            {
                "ok": True,
                "mode": "demo",
                "message": "Ставка принята в демо режиме",
                "bet": payload,
            }
        )

    @app.post("/telegram/webhook")
    def telegram_webhook():
        secret = os.getenv("TELEGRAM_WEBHOOK_SECRET")
        if secret and request.headers.get("X-Telegram-Bot-Api-Secret-Token") != secret:
            return jsonify({"error": "invalid_webhook_secret"}), 401

        update = request.get_json(silent=True) or {}
        return jsonify({"ok": True, "received_update_id": update.get("update_id")})

    return app


def get_supabase_client() -> Client | None:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

    if not url or not key:
        return None

    return create_client(url, key)


def verify_telegram_init_data(init_data: str) -> bool:
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not init_data or not bot_token:
        return False

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        return False

    data_check_string = "\n".join(f"{key}={pairs[key]}" for key in sorted(pairs))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    return hmac.compare_digest(calculated_hash, received_hash)


def parse_telegram_user(init_data: str) -> dict | None:
    if not init_data:
        return None

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    if "user" not in pairs:
        return None

    try:
        return json.loads(pairs["user"])
    except json.JSONDecodeError:
        return None


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
