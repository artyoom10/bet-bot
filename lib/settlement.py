from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lib.config import SPORT_KEYS
from lib.errors import AppError
from lib.odds_api import fetch_scores_for_sport
from lib.supabase_client import SupabaseRestClient
from lib.users import first


def sync_scores_and_settle(
    db: SupabaseRestClient,
    admin_user: dict[str, Any],
    days_from: int = 3,
    *,
    settle: bool = True,
) -> dict[str, Any]:
    run = first(
        db.insert(
            "settlement_runs",
            {
                "status": "started",
                "triggered_by": "admin_mini_app",
                "triggered_by_user_id": admin_user.get("id"),
            },
        )
    )
    if not run:
        raise AppError("settlement_run_create_failed", "Could not create settlement run", 500)

    report = {
        "status": "success",
        "events_checked": 0,
        "events_completed": 0,
        "bets_settled": 0,
        "quota_remaining": None,
        "quota_used": None,
        "quota_last": 0,
        "errors": [],
    }

    try:
        completed_event_ids = []
        for sport_key in SPORT_KEYS:
            try:
                result = fetch_scores_for_sport(sport_key, days_from=days_from)
                report["quota_remaining"] = result.get("quota_remaining")
                report["quota_used"] = result.get("quota_used")
                report["quota_last"] += result.get("quota_last") or 0
                events = result["data"]
                report["events_checked"] += len(events)
                for score_event in events:
                    if not score_event.get("completed"):
                        continue
                    event = update_event_result_from_score(db, sport_key, score_event)
                    if event:
                        report["events_completed"] += 1
                        completed_event_ids.append(event["id"])
            except Exception as exc:
                report["errors"].append({"sport_key": sport_key, "message": str(exc)})

        if settle and completed_event_ids:
            report["bets_settled"] = settle_pending_bets(db, completed_event_ids)

        if report["errors"] and report["events_completed"]:
            report["status"] = "partial_success"
        elif report["errors"] and not report["events_completed"]:
            report["status"] = "error"
    except Exception as exc:
        report["status"] = "error"
        report["errors"].append({"message": str(exc)})
    finally:
        error_message = "; ".join(error["message"] for error in report["errors"])[:1000] or None
        db.update(
            "settlement_runs",
            {
                "status": report["status"],
                "events_checked": report["events_checked"],
                "events_completed": report["events_completed"],
                "bets_settled": report["bets_settled"],
                "quota_remaining": report["quota_remaining"],
                "quota_used": report["quota_used"],
                "quota_last": report["quota_last"],
                "error_message": error_message,
                "finished_at": now_iso(),
            },
            {"id": f"eq.{run['id']}"},
        )

    latest = first(db.select("settlement_runs", {"select": "*", "id": f"eq.{run['id']}", "limit": "1"}))
    return {**report, "run": latest}


def manual_result_and_settle(
    db: SupabaseRestClient,
    admin_user: dict[str, Any],
    event_id: str,
    home_score: int,
    away_score: int,
) -> dict[str, Any]:
    event = first(db.select("events", {"select": "*", "id": f"eq.{event_id}", "limit": "1"}))
    if not event:
        raise AppError("event_not_found", "Event not found", 404)

    winner = result_winner(home_score, away_score)
    updated = first(
        db.update(
            "events",
            {
                "home_score": home_score,
                "away_score": away_score,
                "result_winner": winner,
                "result_payload": {"manual": True, "admin_tg_id": admin_user.get("tg_id")},
                "result_last_update": now_iso(),
                "settled_at": now_iso(),
                "status": "finished",
                "updated_at": now_iso(),
            },
            {"id": f"eq.{event_id}"},
        )
    )
    settle_event_selections(db, event_id, winner)
    settled = settle_pending_bets(db, [event_id])
    return {"event": updated, "bets_settled": settled}


def update_event_result_from_score(db: SupabaseRestClient, sport_key: str, score_event: dict[str, Any]) -> dict[str, Any] | None:
    event = first(
        db.select(
            "events",
            {
                "select": "*",
                "source": "eq.odds_api",
                "external_event_id": f"eq.{score_event['id']}",
                "sport_key": f"eq.{sport_key}",
                "limit": "1",
            },
        )
    )
    if not event:
        return None

    home_score, away_score = extract_scores(score_event)
    winner = result_winner(home_score, away_score) if home_score is not None and away_score is not None else "unknown"
    updated = first(
        db.update(
            "events",
            {
                "home_score": home_score,
                "away_score": away_score,
                "result_winner": winner,
                "result_payload": score_event,
                "result_last_update": now_iso(),
                "settled_at": now_iso(),
                "status": "finished" if winner != "unknown" else "cancelled",
                "updated_at": now_iso(),
            },
            {"id": f"eq.{event['id']}"},
        )
    )
    settle_event_selections(db, event["id"], winner)
    return updated


def settle_event_selections(db: SupabaseRestClient, event_id: str, winner: str) -> None:
    if winner in {"home_win", "draw", "away_win"}:
        selections = db.select("bet_selections", {"select": "*", "event_id": f"eq.{event_id}", "result_status": "eq.pending"})
        for selection in selections:
            status = "won" if selection["selection_key"] == winner else "lost"
            db.update("bet_selections", {"result_status": status}, {"id": f"eq.{selection['id']}"})
        return

    db.update("bet_selections", {"result_status": "refund"}, {"event_id": f"eq.{event_id}", "result_status": "eq.pending"})


def settle_pending_bets(db: SupabaseRestClient, event_ids: list[str] | None = None) -> int:
    params = {"select": "*", "status": "eq.pending", "limit": "1000"}
    bets = db.select("bets", params)
    if not bets:
        return 0

    settled_count = 0
    for bet in bets:
        selections = db.select("bet_selections", {"select": "*", "bet_id": f"eq.{bet['id']}"})
        if event_ids and not any(selection.get("event_id") in event_ids for selection in selections):
            continue
        if not selections or any(selection["result_status"] == "pending" for selection in selections):
            continue

        status, payout = calculate_bet_result(bet, selections)
        claimed = db.update(
            "bets",
            {
                "status": status,
                "payout": payout,
                "settlement_note": "settled_by_scores",
                "settled_at": now_iso(),
            },
            {"id": f"eq.{bet['id']}", "status": "eq.pending"},
        )
        if not claimed:
            continue

        if status == "won":
            credit_wallet(db, bet, payout, "bet_win")
        elif status == "refund":
            credit_wallet(db, bet, payout, "bet_refund")
        elif status == "lost":
            record_loss(db, bet)
        settled_count += 1

    return settled_count


def calculate_bet_result(bet: dict[str, Any], selections: list[dict[str, Any]]) -> tuple[str, float]:
    statuses = [selection["result_status"] for selection in selections]
    amount = float(bet["amount"])
    if "lost" in statuses:
        return "lost", 0.0
    if all(status == "refund" for status in statuses):
        return "refund", amount

    effective_odds = 1.0
    for selection in selections:
        if selection["result_status"] == "won":
            effective_odds *= float(selection["price"])
    return "won", round(amount * effective_odds, 2)


def credit_wallet(db: SupabaseRestClient, bet: dict[str, Any], payout: float, transaction_type: str) -> None:
    wallet = first(db.select("wallets", {"select": "*", "user_id": f"eq.{bet['user_id']}", "currency": "eq.DEMO", "limit": "1"}))
    if not wallet:
        return
    balance_before = float(wallet["balance"])
    balance_after = round(balance_before + payout, 2)
    db.update("wallets", {"balance": balance_after, "updated_at": now_iso()}, {"id": f"eq.{wallet['id']}"})
    db.insert(
        "wallet_transactions",
        {
            "user_id": bet["user_id"],
            "wallet_id": wallet["id"],
            "type": transaction_type,
            "amount": payout,
            "balance_before": balance_before,
            "balance_after": balance_after,
            "related_bet_id": bet["id"],
            "metadata": {"settlement": True},
        },
    )


def record_loss(db: SupabaseRestClient, bet: dict[str, Any]) -> None:
    wallet = first(db.select("wallets", {"select": "*", "user_id": f"eq.{bet['user_id']}", "currency": "eq.DEMO", "limit": "1"}))
    if not wallet:
        return
    balance = float(wallet["balance"])
    db.insert(
        "wallet_transactions",
        {
            "user_id": bet["user_id"],
            "wallet_id": wallet["id"],
            "type": "bet_loss",
            "amount": 0,
            "balance_before": balance,
            "balance_after": balance,
            "related_bet_id": bet["id"],
            "metadata": {"settlement": True},
        },
    )


def get_settlement_runs(db: SupabaseRestClient) -> list[dict[str, Any]]:
    return db.select("settlement_runs", {"select": "*", "order": "started_at.desc", "limit": "20"})


def extract_scores(score_event: dict[str, Any]) -> tuple[int | None, int | None]:
    scores = {item.get("name"): item.get("score") for item in score_event.get("scores") or []}
    home = scores.get(score_event.get("home_team"))
    away = scores.get(score_event.get("away_team"))
    try:
        return int(home), int(away)
    except (TypeError, ValueError):
        return None, None


def result_winner(home_score: int, away_score: int) -> str:
    if home_score > away_score:
        return "home_win"
    if home_score < away_score:
        return "away_win"
    return "draw"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
