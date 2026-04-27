import os
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from lib.admin_auth import require_admin
from lib.bets import get_user_bets, place_bet
from lib.config import app_name
from lib.errors import AppError, error_response
from lib.events import get_events_for_app
from lib.odds_sync import refresh_odds_usage, run_odds_sync
from lib.supabase_client import get_db
from lib.telegram_auth import get_verified_telegram_user
from lib.users import ensure_active_user, first, get_or_create_wallet, upsert_user_from_tg

load_dotenv()

app = Flask(__name__)


@app.errorhandler(Exception)
def handle_error(error: Exception):
    return error_response(error)


@app.get("/")
def index():
    return render_template("index.html", app_name=app_name())


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": app_name(),
            "supabase_configured": bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
            "telegram_configured": bool(os.getenv("TELEGRAM_BOT_TOKEN")),
            "odds_api_configured": bool(os.getenv("ODDS_API_KEY")),
        }
    )


@app.get("/api/me")
def api_me():
    db = get_db()
    tg_user = get_verified_telegram_user(request)
    user = upsert_user_from_tg(db, tg_user)
    wallet = get_or_create_wallet(db, user)

    return jsonify(
        {
            "ok": True,
            "user": public_user(user),
            "wallet": public_wallet(wallet),
        }
    )


@app.get("/api/wallet")
def api_wallet():
    db = get_db()
    user = current_user(db)
    wallet = get_or_create_wallet(db, user)
    return jsonify({"ok": True, "wallet": public_wallet(wallet)})


@app.get("/api/events")
def api_events():
    db = get_db()
    sport_key = request.args.get("sport_key")
    return jsonify(get_events_for_app(db, sport_key=sport_key))


@app.get("/api/events/<event_id>")
def api_event(event_id: str):
    db = get_db()
    event = next((item for item in get_events_for_app(db) if item["id"] == event_id), None)
    if not event:
        raise AppError("event_not_found", "Event not found", 404)
    return jsonify({"ok": True, "event": event})


@app.get("/api/bets")
def api_bets():
    db = get_db()
    user = current_user(db)
    return jsonify(get_user_bets(db, user))


@app.post("/api/bets")
def api_place_bet():
    db = get_db()
    user = current_user(db)
    ensure_active_user(user)
    payload = request.get_json(silent=True) or {}

    result = place_bet(
        db,
        user,
        event_id=payload.get("event_id", ""),
        bookmaker_key=payload.get("bookmaker_key", ""),
        market_key=payload.get("market_key", "h2h"),
        selection_key=payload.get("selection_key", ""),
        amount=float(payload.get("amount", 0)),
    )

    bet = result["bet"]
    return jsonify(
        {
            "ok": True,
            "bet": {
                "id": bet["id"],
                "amount": float(bet["amount"]),
                "total_odds": float(bet["total_odds"]),
                "possible_win": float(bet["possible_win"]),
                "status": bet["status"],
            },
            "wallet": public_wallet(result["wallet"]),
        }
    )


@app.get("/api/admin/dashboard")
def api_admin_dashboard():
    db = get_db()
    require_admin(request, db)

    users = db.select("users", {"select": "id", "limit": "10000"})
    events = db.select("events", {"select": "id", "status": "eq.upcoming", "limit": "10000"})
    pending_bets = db.select("bets", {"select": "id,amount", "status": "eq.pending", "limit": "10000"})
    last_sync = first(db.select("sync_runs", {"select": "*", "order": "started_at.desc", "limit": "1"}))
    usage = first(db.select("odds_api_usage", {"select": "*", "order": "created_at.desc", "limit": "1"}))

    return jsonify(
        {
            "ok": True,
            "stats": {
                "users_count": len(users),
                "active_events_count": len(events),
                "pending_bets_count": len(pending_bets),
                "total_demo_turnover": round(sum(float(bet["amount"]) for bet in pending_bets), 2),
            },
            "last_sync": last_sync,
            "odds_api_usage": usage,
        }
    )


@app.post("/api/admin/sync-odds")
def api_admin_sync_odds():
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    sync = run_odds_sync(
        db,
        triggered_by="admin_mini_app",
        admin_user=admin_user,
        sport_keys=payload.get("sport_keys"),
    )
    return jsonify({"ok": True, "sync": sync})


@app.post("/api/admin/refresh-odds-usage")
def api_admin_refresh_odds_usage():
    db = get_db()
    admin_user = require_admin(request, db)
    usage = refresh_odds_usage(db, admin_user)
    return jsonify({"ok": True, "usage": usage})


@app.get("/api/admin/odds-usage")
def api_admin_odds_usage():
    db = get_db()
    require_admin(request, db)
    usage = first(db.select("odds_api_usage", {"select": "*", "order": "created_at.desc", "limit": "1"}))
    return jsonify({"ok": True, "usage": usage})


@app.get("/api/admin/sync-runs")
def api_admin_sync_runs():
    db = get_db()
    require_admin(request, db)
    runs = db.select("sync_runs", {"select": "*", "order": "started_at.desc", "limit": "20"})
    return jsonify(runs)


@app.get("/api/admin/sync-runs/<sync_run_id>")
def api_admin_sync_run(sync_run_id: str):
    db = get_db()
    require_admin(request, db)
    run = first(db.select("sync_runs", {"select": "*", "id": f"eq.{sync_run_id}", "limit": "1"}))
    if not run:
        raise AppError("sync_run_not_found", "Sync run not found", 404)
    return jsonify({"ok": True, "sync_run": run})


@app.post("/webhook")
@app.post("/telegram/webhook")
def telegram_webhook():
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")
    if secret and request.headers.get("X-Telegram-Bot-Api-Secret-Token") != secret:
        raise AppError("invalid_webhook_secret", "Invalid Telegram webhook secret", 401)

    update = request.get_json(silent=True) or {}
    update_id = update.get("update_id")
    db = get_db()

    if update_id is not None:
        duplicate = first(db.select("telegram_updates", {"select": "update_id", "update_id": f"eq.{update_id}", "limit": "1"}))
        if duplicate:
            return jsonify({"ok": True, "duplicate": True})
        db.insert("telegram_updates", {"update_id": update_id, "payload": update})

    handle_telegram_update(update)
    return jsonify({"ok": True})


def current_user(db):
    tg_user = get_verified_telegram_user(request)
    return upsert_user_from_tg(db, tg_user)


def handle_telegram_update(update: dict[str, Any]) -> None:
    message = update.get("message") or {}
    text = message.get("text") or ""
    chat = message.get("chat") or {}
    chat_id = chat.get("id")

    if text.startswith("/start") and chat_id:
        send_start_button(chat_id)


def send_start_button(chat_id: int | str) -> None:
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    webapp_url = os.getenv("TELEGRAM_WEBAPP_URL", "")
    if not bot_token or not webapp_url:
        return

    try:
        requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": "Открыть демо-букмекерскую",
                "reply_markup": {
                    "inline_keyboard": [
                        [
                            {
                                "text": "Открыть приложение",
                                "web_app": {"url": webapp_url},
                            }
                        ]
                    ]
                },
            },
            timeout=15,
        )
    except requests.RequestException:
        return


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "tg_id": user["tg_id"],
        "username": user.get("username"),
        "first_name": user.get("first_name"),
        "client_status": user.get("client_status"),
        "is_blocked": user.get("is_blocked"),
        "is_admin": user.get("is_admin"),
    }


def public_wallet(wallet: dict[str, Any]) -> dict[str, Any]:
    return {
        "currency": wallet.get("currency", "DEMO"),
        "balance": float(wallet.get("balance", 0)),
        "withdrawable_balance": float(wallet.get("withdrawable_balance", 0)),
        "locked_balance": float(wallet.get("locked_balance", 0)),
    }


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
