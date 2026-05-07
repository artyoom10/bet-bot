import os
from datetime import datetime, timedelta, timezone
from traceback import format_exception
from typing import Any
from uuid import uuid4

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from lib.admin_auth import require_admin
from lib.admin_aliases import create_team_alias, get_aliases_dashboard, update_sport_alias, update_team_alias
from lib.admin_users import create_admin_user, delete_admin_user, list_admin_users, update_admin_user
from lib.bets import delete_admin_bet, get_user_bets, manual_settle_admin_bet, place_bet
from lib.config import SPORT_KEYS, admin_tg_ids, app_name
from lib.errors import AppError, error_response
from lib.events import default_sports, get_events_for_app, get_sports_for_app
from lib.odds_sync import refresh_odds_usage, run_odds_sync, sync_event_markets
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
    existing_profile = find_user_by_tg(db, tg_id)

    if not existing_profile and not matched_admin_env:
        return jsonify(
            {
                "ok": True,
                "access_denied": True,
                "message": "Вы не являетесь членом данного клуба",
            }
        )

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
    try:
        sync = run_odds_sync(
            db,
            triggered_by="admin_mini_app",
            admin_user=admin_user,
            sport_keys=requested_sport_keys(payload),
        )
        return jsonify({"ok": True, "sync": sync, "debug": sync_endpoint_debug(db, payload)})
    except Exception as exc:
        return sync_error_json(db, "sync_odds_failed", exc, payload)


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
    return jsonify(admin_events_payload(db))


@app.get("/api/admin/manual-events")
def api_admin_manual_events():
    db = get_db()
    require_admin(request, db)
    return jsonify({"ok": True, **manual_events_payload(db)})


@app.post("/api/admin/manual-events")
def api_admin_create_manual_event():
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    result = create_manual_event(db, admin_user, payload)
    return jsonify({"ok": True, **result, **manual_events_payload(db)})


@app.patch("/api/admin/manual-events/<event_id>")
def api_admin_update_manual_event(event_id: str):
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    result = update_manual_event(db, admin_user, event_id, payload)
    return jsonify({"ok": True, **result, **manual_events_payload(db)})


@app.delete("/api/admin/manual-events/<event_id>")
def api_admin_delete_manual_event(event_id: str):
    db = get_db()
    admin_user = require_admin(request, db)
    result = delete_manual_event(db, admin_user, event_id)
    return jsonify({"ok": True, **result, **manual_events_payload(db)})


@app.delete("/api/admin/manual-sports/<path:sport_key>")
def api_admin_delete_manual_sport(sport_key: str):
    db = get_db()
    admin_user = require_admin(request, db)
    result = delete_manual_sport(db, admin_user, sport_key)
    return jsonify({"ok": True, **result, **manual_events_payload(db)})


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


@app.delete("/api/admin/users/<user_id>")
def api_admin_delete_user(user_id: str):
    db = get_db()
    admin_user = require_admin(request, db)
    return jsonify({"ok": True, **delete_admin_user(db, admin_user, user_id)})


@app.post("/api/admin/sync-scores-and-settle")
def api_admin_sync_scores_and_settle():
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    try:
        result = sync_scores_and_settle(
            db,
            admin_user,
            days_from=int(payload.get("days_from", 3)),
            sport_keys=requested_sport_keys(payload),
        )
        return jsonify({"ok": True, "settlement": result, "debug": settlement_endpoint_debug(db, payload)})
    except Exception as exc:
        return sync_error_json(db, "sync_scores_and_settle_failed", exc, payload, settlement_endpoint_debug)


@app.post("/api/admin/sync-scores")
def api_admin_sync_scores():
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    try:
        result = sync_scores_and_settle(
            db,
            admin_user,
            days_from=int(payload.get("days_from", 3)),
            settle=False,
            sport_keys=requested_sport_keys(payload),
        )
        return jsonify({"ok": True, "settlement": result, "debug": settlement_endpoint_debug(db, payload)})
    except Exception as exc:
        return sync_error_json(db, "sync_scores_failed", exc, payload, settlement_endpoint_debug)


@app.post("/api/admin/settle-bets")
def api_admin_settle_bets():
    db = get_db()
    require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    try:
        settled = settle_pending_bets(db)
        return jsonify({"ok": True, "bets_settled": settled, "debug": settlement_endpoint_debug(db, payload)})
    except Exception as exc:
        return sync_error_json(db, "settle_bets_failed", exc, payload, settlement_endpoint_debug)


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
        result_note=str(payload.get("result_note") or "").strip() or None,
    )
    return jsonify({"ok": True, "result": result})


@app.post("/api/admin/events/<event_id>/fetch-markets")
def api_admin_fetch_event_markets(event_id: str):
    db = get_db()
    admin_user = require_admin(request, db)
    try:
        result = sync_event_markets(db, event_id, admin_user=admin_user)
        return jsonify({"ok": True, "result": result, "events": admin_events_payload(db)})
    except Exception as exc:
        return sync_error_json(db, "fetch_event_markets_failed", exc, {"event_id": event_id})


@app.get("/api/admin/aliases")
def api_admin_aliases():
    db = get_db()
    require_admin(request, db)
    return jsonify({"ok": True, **get_aliases_dashboard(db)})


@app.patch("/api/admin/sports/<path:sport_key>")
def api_admin_update_sport_alias(sport_key: str):
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    return jsonify({"ok": True, "sport": update_sport_alias(db, admin_user, sport_key, payload)})


@app.delete("/api/admin/sports/<path:sport_key>")
def api_admin_delete_sport_alias(sport_key: str):
    db = get_db()
    admin_user = require_admin(request, db)
    result = delete_manual_sport(db, admin_user, sport_key)
    return jsonify({"ok": True, **result, **manual_events_payload(db)})


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


@app.get("/api/admin/bets")
def api_admin_bets():
    db = get_db()
    require_admin(request, db)
    sort = request.args.get("sort", "created_desc")
    limit = request.args.get("limit", "200")
    return jsonify({"ok": True, "bets": admin_bets_payload(db, sort=sort, limit=limit)})


@app.post("/api/admin/bets/<bet_id>/manual-settlement")
def api_admin_manual_bet_settlement(bet_id: str):
    db = get_db()
    admin_user = require_admin(request, db)
    payload = request.get_json(silent=True) or {}
    result = manual_settle_admin_bet(
        db,
        admin_user,
        bet_id,
        status=str(payload.get("status") or "").strip(),
        payout=payload.get("payout"),
    )
    return jsonify({"ok": True, **result, "bets": admin_bets_payload(db, sort="created_desc", limit="250")})


@app.delete("/api/admin/bets/<bet_id>")
def api_admin_delete_bet(bet_id: str):
    db = get_db()
    admin_user = require_admin(request, db)
    result = delete_admin_bet(db, admin_user, bet_id)
    return jsonify({"ok": True, **result, "bets": admin_bets_payload(db, sort="created_desc", limit="250")})


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
    tg_id = str(tg_user["tg_id"])
    if not find_user_by_tg(db, tg_id) and tg_id not in admin_tg_ids():
        raise AppError("not_member", "Вы не являетесь членом данного клуба", 403)
    return upsert_user_from_tg(db, tg_user)


def find_user_by_tg(db, tg_id: str) -> dict[str, Any] | None:
    return first(db.select("users", {"select": "*", "tg_id": f"eq.{tg_id}", "limit": "1"}))


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
        "block_reason": user.get("block_reason"),
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


def sync_error_json(db, error_code: str, exc: Exception, payload: dict[str, Any], debug_builder=None):
    status_code = exc.status_code if isinstance(exc, AppError) else 500
    debug_builder = debug_builder or sync_endpoint_debug
    debug = debug_builder(db, payload)
    debug["exception"] = exception_debug(exc)
    return (
        jsonify(
            {
                "ok": False,
                "error": error_code,
                "message": str(exc),
                "debug": debug,
            }
        ),
        status_code,
    )


def sync_endpoint_debug(db, payload: dict[str, Any]) -> dict[str, Any]:
    debug = base_endpoint_debug(payload)
    sports = requested_sport_keys(payload) or SPORT_KEYS
    debug["requested_sport_keys"] = sports
    debug["sync_runs"] = safe_debug_select(db, "sync_runs", {"select": "*", "order": "started_at.desc", "limit": "5"})
    debug["last_sync"] = normalize_last_sync(first(debug["sync_runs"]["rows"])) if debug["sync_runs"].get("ok") else None
    debug["sports"] = safe_debug_select(db, "sports", {"select": "*", "order": "sport_key.asc", "limit": "20"})
    debug["requested_sport_events"] = {
        sport_key: safe_debug_select(
            db,
            "events",
            {
                "select": "id,sport_key,external_event_id,home_team_raw,away_team_raw,status,commence_time,last_odds_sync_at,updated_at",
                "sport_key": f"eq.{sport_key}",
                "order": "commence_time.asc",
                "limit": "20",
            },
        )
        for sport_key in sports
    }
    debug["recent_events"] = safe_debug_select(
        db,
        "events",
        {"select": "id,sport_key,external_event_id,home_team_raw,away_team_raw,status,commence_time,last_odds_sync_at,updated_at", "order": "updated_at.desc", "limit": "10"},
    )
    return debug


def settlement_endpoint_debug(db, payload: dict[str, Any]) -> dict[str, Any]:
    debug = base_endpoint_debug(payload)
    debug["settlement_runs"] = safe_debug_select(db, "settlement_runs", {"select": "*", "order": "started_at.desc", "limit": "5"})
    debug["pending_bets"] = safe_debug_select(db, "bets", {"select": "id,user_id,status,bet_type,amount,total_odds,created_at", "status": "eq.pending", "limit": "20"})
    debug["finished_events"] = safe_debug_select(
        db,
        "events",
        {"select": "id,sport_key,external_event_id,home_team_raw,away_team_raw,status,home_score,away_score,result_winner,result_note,result_last_update", "status": "in.(finished,cancelled)", "order": "result_last_update.desc", "limit": "10"},
    )
    return debug


def base_endpoint_debug(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "endpoint": request.path,
        "method": request.method,
        "payload": payload,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "env_flags": {
            "supabase_url_set": bool(os.getenv("SUPABASE_URL")),
            "supabase_service_key_set": bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
            "odds_api_key_set": bool(os.getenv("ODDS_API_KEY")),
        },
    }


def requested_sport_keys(payload: dict[str, Any]) -> list[str] | None:
    sport_keys = payload.get("sport_keys")
    if isinstance(sport_keys, str):
        return [sport_keys] if sport_keys else None
    if isinstance(sport_keys, list):
        return [str(item) for item in sport_keys if item]
    return None


def admin_events_payload(db) -> list[dict[str, Any]]:
    events = db.select(
        "events",
        {
            "select": "*",
            "order": "commence_time.desc",
            "limit": "250",
        },
    )
    if not events:
        return []

    sport_keys = sorted({event["sport_key"] for event in events if event.get("sport_key")})
    sports = {
        row["sport_key"]: row
        for row in db.select("sports", {"select": "*", "sport_key": f"in.({','.join(sport_keys)})"})
    } if sport_keys else {}

    event_ids = [event["id"] for event in events if event.get("id")]
    odds_rows = db.select(
        "odds_current",
        {
            "select": "event_id,market_key",
            "event_id": f"in.({','.join(event_ids)})",
            "limit": "10000",
        },
    ) if event_ids else []
    odds_count_by_event: dict[str, int] = {}
    markets_by_event: dict[str, set[str]] = {}
    for row in odds_rows:
        odds_count_by_event[row["event_id"]] = odds_count_by_event.get(row["event_id"], 0) + 1
        markets_by_event.setdefault(row["event_id"], set()).add(row["market_key"])

    result = []
    for event in events:
        sport = sports.get(event["sport_key"], {})
        result.append(
            {
                **event,
                "league_title": sport.get("title_ru") or sport.get("title_en") or event["sport_key"],
                "league_logo_url": sport.get("logo_url") or None,
                "odds_count": odds_count_by_event.get(event["id"], 0),
                "markets_count": len(markets_by_event.get(event["id"], set())),
                "can_fetch_markets": event.get("source") == "odds_api" and bool(event.get("external_event_id")),
            }
        )
    return result


def manual_events_payload(db) -> dict[str, Any]:
    sports = db.select("sports", {"select": "*", "is_enabled": "eq.true", "order": "title_ru.asc", "limit": "200"})
    teams = db.select("teams", {"select": "*", "is_active": "eq.true", "order": "name_ru.asc", "limit": "500"})
    events = db.select(
        "events",
        {
            "select": "*",
            "source": "eq.manual",
            "order": "commence_time.desc",
            "limit": "100",
        },
    )
    if events:
        event_ids = [event["id"] for event in events]
        odds = db.select(
            "odds_current",
            {
                "select": "*",
                "event_id": f"in.({','.join(event_ids)})",
                "bookmaker_key": "eq.manual",
                "order": "market_key.asc,selection_key.asc",
            },
        )
        odds_by_event: dict[str, list[dict[str, Any]]] = {}
        for odd in odds:
            odd["price"] = float(odd["price"])
            odds_by_event.setdefault(odd["event_id"], []).append(odd)
        for event in events:
            event["odds"] = odds_by_event.get(event["id"], [])
    return {"sports": sports, "teams": teams, "events": events}


def admin_bets_payload(db, *, sort: str, limit: str) -> list[dict[str, Any]]:
    try:
        parsed_limit = min(max(int(limit), 1), 500)
    except (TypeError, ValueError):
        parsed_limit = 200

    order_map = {
        "created_desc": "created_at.desc",
        "created_asc": "created_at.asc",
        "amount_desc": "amount.desc",
        "amount_asc": "amount.asc",
    }
    bets = db.select(
        "bets",
        {
            "select": "*",
            "order": order_map.get(sort, "created_at.desc"),
            "limit": str(parsed_limit),
        },
    )
    if not bets:
        return []

    user_ids = sorted({bet["user_id"] for bet in bets if bet.get("user_id")})
    bet_ids = [bet["id"] for bet in bets if bet.get("id")]
    users = db.select("users", {"select": "id,tg_id,username,first_name,last_name,client_status,is_blocked", "id": f"in.({','.join(user_ids)})"}) if user_ids else []
    selections = db.select("bet_selections", {"select": "*", "bet_id": f"in.({','.join(bet_ids)})", "order": "created_at.asc"}) if bet_ids else []

    users_by_id = {user["id"]: user for user in users}
    selections_by_bet: dict[str, list[dict[str, Any]]] = {}
    for selection in selections:
        selection["price"] = float(selection.get("price") or 0)
        selections_by_bet.setdefault(selection["bet_id"], []).append(selection)

    rows = []
    for bet in bets:
        item = {
            "bet": {
                **bet,
                "amount": float(bet.get("amount") or 0),
                "total_odds": float(bet.get("total_odds") or 0),
                "possible_win": float(bet.get("possible_win") or 0),
                "payout": float(bet.get("payout") or 0) if bet.get("payout") is not None else None,
            },
            "user": users_by_id.get(bet.get("user_id")),
            "selections": selections_by_bet.get(bet["id"], []),
        }
        rows.append(item)

    if sort == "user":
        rows.sort(key=lambda row: (user_sort_name(row.get("user")), row["bet"].get("created_at") or ""), reverse=False)
    return rows


def user_sort_name(user: dict[str, Any] | None) -> str:
    if not user:
        return ""
    return " ".join([str(user.get("first_name") or ""), str(user.get("last_name") or ""), str(user.get("username") or ""), str(user.get("tg_id") or "")]).strip().lower()


def create_manual_event(db, admin_user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    sport = ensure_manual_sport(db, payload)
    sport_type = manual_sport_type(payload)
    home_team = ensure_manual_team(db, payload.get("home_team_id"), payload.get("home_team_name"), sport_type)
    away_team = ensure_manual_team(db, payload.get("away_team_id"), payload.get("away_team_name"), sport_type)
    if home_team["id"] == away_team["id"]:
        raise AppError("same_team", "Выберите разные команды", 400)

    commence_time = parse_manual_datetime(payload.get("commence_time"))
    now = datetime.now(timezone.utc).isoformat()
    event = first(
        db.insert(
            "events",
            {
                "source": "manual",
                "external_event_id": f"manual:{uuid4().hex}",
                "sport_key": sport["sport_key"],
                "home_team_id": home_team["id"],
                "away_team_id": away_team["id"],
                "home_team_raw": home_team["name_en"],
                "away_team_raw": away_team["name_en"],
                "commence_time": commence_time,
                "status": "upcoming",
                "raw_payload": manual_raw_payload(payload, admin_user),
                "last_odds_sync_at": now,
                "updated_at": now,
            },
        )
    )
    if not event:
        raise AppError("manual_event_create_failed", "Не удалось создать матч", 500)

    db.upsert("bookmakers", {"bookmaker_key": "manual", "title": "Manual", "updated_at": now}, "bookmaker_key")
    save_manual_odds(db, event["id"], home_team, away_team, payload, now)
    return {"event": event}


def update_manual_event(db, admin_user: dict[str, Any], event_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    existing = first(db.select("events", {"select": "*", "id": f"eq.{event_id}", "source": "eq.manual", "limit": "1"}))
    if not existing:
        raise AppError("manual_event_not_found", "Ручное событие не найдено", 404)

    sport = ensure_manual_sport(db, payload)
    sport_type = manual_sport_type(payload)
    home_team = ensure_manual_team(db, payload.get("home_team_id"), payload.get("home_team_name"), sport_type)
    away_team = ensure_manual_team(db, payload.get("away_team_id"), payload.get("away_team_name"), sport_type)
    if home_team["id"] == away_team["id"]:
        raise AppError("same_team", "Выберите разные команды", 400)

    now = datetime.now(timezone.utc).isoformat()
    event = first(
        db.update(
            "events",
            {
                "sport_key": sport["sport_key"],
                "home_team_id": home_team["id"],
                "away_team_id": away_team["id"],
                "home_team_raw": home_team["name_en"],
                "away_team_raw": away_team["name_en"],
                "commence_time": parse_manual_datetime(payload.get("commence_time")),
                "status": clean_event_status(payload.get("status") or existing.get("status")),
                "raw_payload": manual_raw_payload(payload, admin_user, existing.get("raw_payload")),
                "last_odds_sync_at": now,
                "updated_at": now,
            },
            {"id": f"eq.{event_id}"},
        )
    )
    db.delete("odds_current", {"event_id": f"eq.{event_id}", "bookmaker_key": "eq.manual"})
    save_manual_odds(db, event_id, home_team, away_team, payload, now)
    return {"event": event}


def delete_manual_event(db, admin_user: dict[str, Any], event_id: str) -> dict[str, Any]:
    existing = first(db.select("events", {"select": "*", "id": f"eq.{event_id}", "source": "eq.manual", "limit": "1"}))
    if not existing:
        raise AppError("manual_event_not_found", "Ручное событие не найдено", 404)

    linked = db.select("bet_selections", {"select": "id", "event_id": f"eq.{event_id}", "limit": "1"})
    if linked:
        now = datetime.now(timezone.utc).isoformat()
        event = first(
            db.update(
                "events",
                {
                    "status": "cancelled",
                    "result_winner": "cancelled",
                    "settled_at": now,
                    "updated_at": now,
                    "raw_payload": deleted_event_payload(existing.get("raw_payload"), admin_user),
                },
                {"id": f"eq.{event_id}"},
            )
        )
        db.update(
            "bet_selections",
            {"result_status": "refund"},
            {"event_id": f"eq.{event_id}", "result_status": "eq.pending"},
            return_rows=False,
        )
        settled = settle_pending_bets(db, [event_id])
        return {"deleted": False, "cancelled": True, "event": event, "bets_settled": settled}

    db.delete("odds_current", {"event_id": f"eq.{event_id}", "bookmaker_key": "eq.manual"})
    deleted = db.delete("events", {"id": f"eq.{event_id}", "source": "eq.manual"})
    return {"deleted": True, "event": first(deleted) or existing}


def delete_event_in_manual_sport(db, admin_user: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    event_id = event["id"]
    linked = db.select("bet_selections", {"select": "id", "event_id": f"eq.{event_id}", "limit": "1"})
    if linked:
        now = datetime.now(timezone.utc).isoformat()
        event = first(
            db.update(
                "events",
                {
                    "status": "cancelled",
                    "result_winner": "cancelled",
                    "settled_at": now,
                    "updated_at": now,
                    "raw_payload": deleted_event_payload(event.get("raw_payload"), admin_user),
                },
                {"id": f"eq.{event_id}"},
            )
        )
        db.update(
            "bet_selections",
            {"result_status": "refund"},
            {"event_id": f"eq.{event_id}", "result_status": "eq.pending"},
            return_rows=False,
        )
        settled = settle_pending_bets(db, [event_id])
        db.update("bet_selections", {"event_id": None}, {"event_id": f"eq.{event_id}"}, return_rows=False)
        db.delete("odds_current", {"event_id": f"eq.{event_id}"})
        deleted = db.delete("events", {"id": f"eq.{event_id}"})
        return {
            "deleted": True,
            "cancelled": True,
            "event": first(deleted) or event,
            "bets_settled": settled,
        }

    db.delete("odds_current", {"event_id": f"eq.{event_id}"})
    deleted = db.delete("events", {"id": f"eq.{event_id}"})
    return {"deleted": True, "event": first(deleted) or event}


def delete_manual_sport(db, admin_user: dict[str, Any], sport_key: str) -> dict[str, Any]:
    sport = first(db.select("sports", {"select": "*", "sport_key": f"eq.{sport_key}", "limit": "1"}))
    if not sport:
        raise AppError("manual_sport_not_found", "Ручное соревнование не найдено", 404)
    is_manual_sport = sport.get("source") == "manual" or str(sport_key).startswith("manual_")
    if not is_manual_sport:
        raise AppError("manual_sport_not_found", "Удалять можно только созданные вручную соревнования", 400)

    events = db.select("events", {"select": "*", "sport_key": f"eq.{sport_key}", "limit": "1000"})
    summary = {"events_scanned": len(events), "events_deleted": 0, "events_cancelled": 0, "bets_settled": 0}
    for event in events:
        result = delete_event_in_manual_sport(db, admin_user, event)
        if result.get("deleted"):
            summary["events_deleted"] += 1
        if result.get("cancelled"):
            summary["events_cancelled"] += 1
        summary["bets_settled"] += int(result.get("bets_settled") or 0)

    db.delete("team_source_aliases", {"sport_key": f"eq.{sport_key}"})
    remaining = db.select("events", {"select": "id", "sport_key": f"eq.{sport_key}", "limit": "1"})
    if remaining:
        disabled = first(
            db.update(
                "sports",
                {"is_enabled": False, "updated_at": datetime.now(timezone.utc).isoformat()},
                {"sport_key": f"eq.{sport_key}"},
                return_rows=False,
            )
        )
        return {"deleted": False, "disabled": True, "sport": disabled or sport, **summary}

    deleted = db.delete("sports", {"sport_key": f"eq.{sport_key}"})
    return {"deleted": True, "sport": first(deleted) or sport, **summary}


def deleted_event_payload(raw_payload: Any, admin_user: dict[str, Any]) -> dict[str, Any]:
    if isinstance(raw_payload, dict):
        payload = dict(raw_payload)
    elif raw_payload is None:
        payload = {}
    else:
        payload = {"previous_payload": raw_payload}
    payload["deleted_by_admin_tg_id"] = admin_user.get("tg_id")
    return payload


def save_manual_odds(
    db,
    event_id: str,
    home_team: dict[str, Any],
    away_team: dict[str, Any],
    payload: dict[str, Any],
    now: str,
) -> None:
    rows = manual_market_rows(event_id, home_team, away_team, payload, now)
    if not rows:
        raise AppError("manual_markets_required", "Добавьте хотя бы один рынок", 400)
    db.upsert("odds_current", rows, "event_id,bookmaker_key,market_key,selection_key")


def manual_market_rows(
    event_id: str,
    home_team: dict[str, Any],
    away_team: dict[str, Any],
    payload: dict[str, Any],
    now: str,
) -> list[dict[str, Any]]:
    rows = [
        manual_odd_row(event_id, "h2h", "home_win", home_team["name_ru"], parse_price(payload.get("home_price", 1.8), "П1"), now),
        manual_odd_row(event_id, "h2h", "draw", "Ничья", parse_price(payload.get("draw_price", 3.2), "X"), now),
        manual_odd_row(event_id, "h2h", "away_win", away_team["name_ru"], parse_price(payload.get("away_price", 2.1), "П2"), now),
    ]

    if as_bool(payload.get("totals_enabled")):
        line = parse_line(payload.get("total_line"), "тотала")
        key = line_key(line)
        rows.extend(
            [
                manual_odd_row(event_id, "totals", f"total_over_{key}", f"Тотал больше {format_line(line)}", parse_price(payload.get("total_over_price"), "ТБ"), now),
                manual_odd_row(event_id, "totals", f"total_under_{key}", f"Тотал меньше {format_line(line)}", parse_price(payload.get("total_under_price"), "ТМ"), now),
            ]
        )

    if as_bool(payload.get("handicap_enabled")):
        line = parse_line(payload.get("handicap_line"), "форы")
        rows.extend(
            [
                manual_odd_row(
                    event_id,
                    "spreads",
                    f"handicap_home_{line_key(line)}",
                    f"{home_team['name_ru']} фора {format_signed_line(line)}",
                    parse_price(payload.get("handicap_home_price"), "Ф1"),
                    now,
                ),
                manual_odd_row(
                    event_id,
                    "spreads",
                    f"handicap_away_{line_key(-line)}",
                    f"{away_team['name_ru']} фора {format_signed_line(-line)}",
                    parse_price(payload.get("handicap_away_price"), "Ф2"),
                    now,
                ),
            ]
        )

    if as_bool(payload.get("video_enabled")):
        rows.extend(
            [
                manual_odd_row(event_id, "video_review", "video_review_yes", "Видеопросмотр - да", parse_price(payload.get("video_yes_price"), "видеопросмотр да"), now),
                manual_odd_row(event_id, "video_review", "video_review_no", "Видеопросмотр - нет", parse_price(payload.get("video_no_price"), "видеопросмотр нет"), now),
            ]
        )

    player_name = str(payload.get("player_name") or "").strip()
    if as_bool(payload.get("player_goal_enabled")):
        if not player_name:
            raise AppError("player_required", "Укажите игрока для рынка гола или передачи", 400)
        rows.extend(
            [
                manual_odd_row(event_id, "player_goal", "player_goal_yes", f"Гол {player_name} - да", parse_price(payload.get("player_goal_yes_price"), "гол да"), now),
                manual_odd_row(event_id, "player_goal", "player_goal_no", f"Гол {player_name} - нет", parse_price(payload.get("player_goal_no_price"), "гол нет"), now),
            ]
        )

    if as_bool(payload.get("player_assist_enabled")):
        if not player_name:
            raise AppError("player_required", "Укажите игрока для рынка гола или передачи", 400)
        rows.extend(
            [
                manual_odd_row(event_id, "player_assist", "player_assist_yes", f"Передача {player_name} - да", parse_price(payload.get("player_assist_yes_price"), "передача да"), now),
                manual_odd_row(event_id, "player_assist", "player_assist_no", f"Передача {player_name} - нет", parse_price(payload.get("player_assist_no_price"), "передача нет"), now),
            ]
        )

    return rows


def manual_odd_row(event_id: str, market_key: str, selection_key: str, name: str, price: float, now: str) -> dict[str, Any]:
    return {
        "event_id": event_id,
        "bookmaker_key": "manual",
        "market_key": market_key,
        "selection_key": selection_key,
        "selection_name_raw": name,
        "selection_name_ru": name,
        "price": price,
        "api_last_update": now,
        "updated_at": now,
    }


def manual_raw_payload(payload: dict[str, Any], admin_user: dict[str, Any], previous: dict[str, Any] | None = None) -> dict[str, Any]:
    market_config = {
        "sport_type": manual_sport_type(payload),
        "totals_enabled": as_bool(payload.get("totals_enabled")),
        "total_line": payload.get("total_line"),
        "handicap_enabled": as_bool(payload.get("handicap_enabled")),
        "handicap_line": payload.get("handicap_line"),
        "video_enabled": as_bool(payload.get("video_enabled")),
        "player_name": str(payload.get("player_name") or "").strip() or None,
        "player_goal_enabled": as_bool(payload.get("player_goal_enabled")),
        "player_assist_enabled": as_bool(payload.get("player_assist_enabled")),
    }
    base = previous or {}
    return {
        **base,
        "created_by": base.get("created_by") or "admin_constructor",
        "admin_tg_id": base.get("admin_tg_id") or admin_user.get("tg_id"),
        "updated_by_admin_tg_id": admin_user.get("tg_id"),
        "market_config": market_config,
    }


def clean_event_status(value: Any) -> str:
    status = str(value or "upcoming").strip()
    if status not in {"upcoming", "finished", "cancelled"}:
        raise AppError("invalid_event_status", "Некорректный статус события", 400)
    return status


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def parse_line(value: Any, label: str) -> float:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError) as exc:
        raise AppError("invalid_line", f"Некорректная линия {label}", 400) from exc


def line_key(value: float) -> str:
    sign = "m" if value < 0 else "p"
    return f"{sign}{str(abs(value)).replace('.', 'p')}"


def format_line(value: float) -> str:
    return f"{value:g}"


def format_signed_line(value: float) -> str:
    return f"{value:+g}"


def ensure_manual_sport(db, payload: dict[str, Any]) -> dict[str, Any]:
    title = str(payload.get("sport_title") or "").strip()
    sport_key = str(payload.get("sport_key") or "").strip()
    sport_type = manual_sport_type(payload)
    if title:
        sport_key = f"manual_{sport_type}_{slugify(title)}_{uuid4().hex[:6]}"
        sport = first(
            db.insert(
                "sports",
                {
                    "source": "manual",
                    "sport_key": sport_key,
                    "title_en": title,
                    "title_ru": title,
                    "group_name": sport_type,
                    "is_enabled": True,
                },
            )
        )
        if not sport:
            raise AppError("sport_create_failed", "Не удалось создать соревнование", 500)
        return sport

    if not sport_key:
        raise AppError("sport_required", "Выберите или создайте соревнование", 400)
    sport = first(db.select("sports", {"select": "*", "sport_key": f"eq.{sport_key}", "limit": "1"}))
    if not sport:
        raise AppError("sport_not_found", "Соревнование не найдено", 404)
    return sport


def ensure_manual_team(db, team_id: str | None, name: str | None, sport_type: str) -> dict[str, Any]:
    if team_id:
        team = first(db.select("teams", {"select": "*", "id": f"eq.{team_id}", "limit": "1"}))
        if team:
            return team

    clean_name = str(name or "").strip()
    if not clean_name:
        raise AppError("team_required", "Выберите команду или введите новую", 400)

    existing = first(db.select("teams", {"select": "*", "name_ru": f"eq.{clean_name}", "limit": "1"}))
    if existing:
        return existing

    team = first(
        db.insert(
            "teams",
            {
                "name_en": clean_name,
                "name_ru": clean_name,
                "short_name_ru": clean_name,
                "slug": f"{slugify(clean_name)}-{uuid4().hex[:8]}",
                "sport_type": sport_type,
            },
        )
    )
    if not team:
        raise AppError("team_create_failed", "Не удалось создать команду", 500)
    return team


def manual_sport_type(payload: dict[str, Any]) -> str:
    value = str(payload.get("sport_type") or "soccer").strip().lower()
    if value not in {"soccer", "hockey", "esports"}:
        raise AppError("invalid_sport_type", "Выберите футбол, хоккей или киберспорт", 400)
    return value


def parse_manual_datetime(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise AppError("commence_time_required", "Укажите дату и время матча", 400)
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise AppError("invalid_commence_time", "Некорректная дата матча", 400) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone(timedelta(hours=3)))
    return parsed.astimezone(timezone.utc).isoformat()


def parse_price(value: Any, label: str) -> float:
    try:
        price = round(float(value), 2)
    except (TypeError, ValueError) as exc:
        raise AppError("invalid_price", f"Некорректный коэффициент {label}", 400) from exc
    if price <= 1:
        raise AppError("invalid_price", f"Коэффициент {label} должен быть больше 1", 400)
    return price


def selection_name(key: str, home_team: dict[str, Any], away_team: dict[str, Any]) -> str:
    if key == "home_win":
        return home_team["name_ru"]
    if key == "away_win":
        return away_team["name_ru"]
    return "Ничья"


def slugify(value: str) -> str:
    cleaned = "".join(char.lower() if char.isalnum() else "-" for char in value)
    return "-".join(part for part in cleaned.split("-") if part)[:70] or "item"


def safe_debug_select(db, table: str, params: dict[str, Any]) -> dict[str, Any]:
    try:
        rows = db.select(table, params)
        return {"ok": True, "count": len(rows), "rows": rows}
    except Exception as exc:
        return {"ok": False, "table": table, "error": exception_debug(exc)}


def exception_debug(exc: Exception) -> dict[str, Any]:
    return {
        "type": exc.__class__.__name__,
        "message": str(exc),
        "traceback": "".join(format_exception(type(exc), exc, exc.__traceback__))[-5000:],
    }


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
