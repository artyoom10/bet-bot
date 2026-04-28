import os
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from lib.admin_auth import require_admin
from lib.admin_aliases import create_team_alias, get_aliases_dashboard, update_sport_alias, update_team_alias
from lib.admin_users import create_admin_user, list_admin_users, update_admin_user
from lib.bets import get_user_bets, place_bet
from lib.config import admin_tg_ids, app_name
from lib.errors import AppError, error_response
from lib.events import default_sports, get_events_for_app, get_sports_for_app
from lib.odds_sync import refresh_odds_usage, run_odds_sync
from lib.settlement import get_settlement_runs, manual_result_and_settle, settle_pending_bets, sync_scores_and_settle
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
    tg_id = str(tg_user["tg_id"])
    matched_admin_env = tg_id in admin_tg_ids()
    profile_error = None

    is_admin_from_db = False
    try:
        user = upsert_user_from_tg(db, tg_user)
        wallet = get_or_create_wallet(db, user)
        is_admin_from_db = bool(user.get("is_admin"))
    except Exception as exc:
        if not matched_admin_env:
            raise
        profile_error = str(exc)
        user = synthetic_user_from_tg(tg_user, is_admin=True)
        wallet = default_wallet()

    if matched_admin_env and not user.get("is_admin"):
        user["is_admin"] = True

    response = {
        "ok": True,
        "user": public_user(user),
        "wallet": public_wallet(wallet),
    }
    if os.getenv("DEBUG_ADMIN") == "1":
        response["admin_debug"] = {
            "tg_id": tg_id,
            "is_admin_from_db": is_admin_from_db,
            "matched_admin_env": matched_admin_env,
            "is_admin_final": bool(user.get("is_admin") or matched_admin_env),
            "admin_ids_configured": len(admin_tg_ids()),
            "profile_loaded": profile_error is None,
            "profile_error": profile_error,
        }
    return jsonify(response)


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


@app.get("/api/sports")
def api_sports():
    db = get_db()
    try:
        return jsonify(get_sports_for_app(db))
    except AppError as exc:
        if exc.error != "supabase_not_configured":
            raise
        return jsonify(
            [
                {"sport_key": sport["sport_key"], "title": sport["title_ru"], "events_count": 0}
                for sport in default_sports()
            ]
        )


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

    selections = payload.get("selections")
    if not selections:
        selections = [
            {
                "event_id": payload.get("event_id", ""),
                "bookmaker_key": payload.get("bookmaker_key", ""),
                "market_key": payload.get("market_key", "h2h"),
                "selection_key": payload.get("selection_key", ""),
            }
        ]

    result = place_bet(db, user, amount=float(payload.get("amount", 0)), selections=selections)

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
    last_sync = normalize_last_sync(first(db.select("sync_runs", {"select": "*", "order": "started_at.desc", "limit": "1"})))
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


@app.get("/api/admin/users")
def api_admin_users():
    db = get_db()
    require_admin(request, db)
    return jsonify(list_admin_users(db))


@app.get("/api/admin/events")
def api_admin_events():
    db = get_db()
    require_admin(request, db)
    events = db.select("events", {"select": "*", "order": "commence_time.desc", "limit": "100"})
    return jsonify(events)


@app.post("/api/admin/users")
def api_admin_create_user():
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    return jsonify({"ok": True, **create_admin_user(db, admin_user, payload)})


@app.patch("/api/admin/users/<user_id>")
def api_admin_update_user(user_id: str):
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    return jsonify({"ok": True, **update_admin_user(db, admin_user, user_id, payload)})


@app.post("/api/admin/sync-scores-and-settle")
def api_admin_sync_scores_and_settle():
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    result = sync_scores_and_settle(db, admin_user, days_from=int(payload.get("days_from", 3)))
    return jsonify({"ok": True, "settlement": result})


@app.post("/api/admin/sync-scores")
def api_admin_sync_scores():
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    result = sync_scores_and_settle(db, admin_user, days_from=int(payload.get("days_from", 3)), settle=False)
    return jsonify({"ok": True, "settlement": result})


@app.post("/api/admin/settle-bets")
def api_admin_settle_bets():
    db = get_db()
    require_admin(request, db)
    settled = settle_pending_bets(db)
    return jsonify({"ok": True, "bets_settled": settled})


@app.get("/api/admin/settlement-runs")
def api_admin_settlement_runs():
    db = get_db()
    require_admin(request, db)
    return jsonify(get_settlement_runs(db))


@app.post("/api/admin/events/<event_id>/manual-result")
def api_admin_manual_result(event_id: str):
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    try:
        home_score = int(payload.get("home_score"))
        away_score = int(payload.get("away_score"))
    except (TypeError, ValueError) as exc:
        raise AppError("invalid_score", "Введите корректный счет", 400) from exc

    result = manual_result_and_settle(
        db,
        admin_user,
        event_id,
        home_score=home_score,
        away_score=away_score,
    )
    return jsonify({"ok": True, "result": result})


@app.get("/api/admin/aliases")
def api_admin_aliases():
    db = get_db()
    require_admin(request, db)
    return jsonify({"ok": True, **get_aliases_dashboard(db)})


@app.patch("/api/admin/sports/<sport_key>")
def api_admin_update_sport_alias(sport_key: str):
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    return jsonify({"ok": True, "sport": update_sport_alias(db, admin_user, sport_key, payload)})


@app.patch("/api/admin/teams/<team_id>")
def api_admin_update_team_alias(team_id: str):
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    return jsonify({"ok": True, "team": update_team_alias(db, admin_user, team_id, payload)})


@app.post("/api/admin/team-aliases")
def api_admin_create_team_alias():
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    return jsonify({"ok": True, **create_team_alias(db, admin_user, payload)})


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
        "last_name": user.get("last_name"),
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


def synthetic_user_from_tg(tg_user: dict[str, Any], is_admin: bool = False) -> dict[str, Any]:
    return {
        "id": None,
        "tg_id": str(tg_user["tg_id"]),
        "username": tg_user.get("username"),
        "first_name": tg_user.get("first_name"),
        "last_name": tg_user.get("last_name"),
        "client_status": "telegram_only",
        "is_blocked": False,
        "is_admin": is_admin,
    }


def default_wallet() -> dict[str, Any]:
    return {
        "currency": "DEMO",
        "balance": 0,
        "withdrawable_balance": 0,
        "locked_balance": 0,
    }


def normalize_last_sync(sync: dict[str, Any] | None) -> dict[str, Any] | None:
    if not sync:
        return None
    item = {
        "id": sync.get("id"),
        "status": sync.get("status"),
        "events_count": sync.get("events_count") or 0,
        "odds_count": sync.get("odds_count") or 0,
        "bookmakers_count": sync.get("bookmakers_count") or 0,
        "quota_remaining": sync.get("quota_remaining"),
        "quota_used": sync.get("quota_used"),
        "quota_last": sync.get("quota_last"),
        "started_at": sync.get("started_at"),
        "finished_at": sync.get("finished_at"),
        "error_message": sync.get("error_message"),
    }
    if item["status"] == "started" and not item["finished_at"]:
        item["status"] = "stale"
        item["error_message"] = item["error_message"] or "Sync did not finish correctly"
    return item


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
