from __future__ import annotations

from datetime import datetime, timezone
from traceback import format_exception
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
    sport_keys: list[str] | None = None,
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

    selected_sports = sport_keys or SPORT_KEYS
    report = {
        "status": "success",
        "events_checked": 0,
        "events_completed": 0,
        "bets_settled": 0,
        "quota_remaining": None,
        "quota_used": None,
        "quota_last": 0,
        "errors": [],
        "settle_enabled": settle,
        "selected_sports": selected_sports,
        "sport_results": [],
        "debug_steps": [{"step": "settlement_run_created", "settlement_run_id": run["id"], "at": run["started_at"]}],
    }

    try:
        completed_event_ids = []
        for sport_key in selected_sports:
            sport_started_at = datetime.now(timezone.utc)
            sport_report = {"sport_key": sport_key, "status": "started", "started_at": sport_started_at.isoformat()}
            try:
                result = fetch_scores_for_sport(sport_key, days_from=days_from)
                report["quota_remaining"] = result.get("quota_remaining")
                report["quota_used"] = result.get("quota_used")
                report["quota_last"] += result.get("quota_last") or 0
                events = result["data"]
                report["events_checked"] += len(events)
                sport_report.update(
                    {
                        "request_url": result.get("request_url"),
                        "quota_remaining": result.get("quota_remaining"),
                        "quota_used": result.get("quota_used"),
                        "quota_last": result.get("quota_last"),
                        "api_events_count": len(events),
                        "completed_from_api": sum(1 for event in events if event.get("completed")),
                        "matched_events": 0,
                        "updated_event_ids": [],
                    }
                )
                for score_event in events:
                    if not score_event.get("completed"):
                        continue
                    event = update_event_result_from_score(db, sport_key, score_event)
                    if event:
                        report["events_completed"] += 1
                        completed_event_ids.append(event["id"])
                        sport_report["matched_events"] += 1
                        sport_report["updated_event_ids"].append(event["id"])
                sport_report.update(
                    {
                        "status": "success",
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                        "duration_seconds": round((datetime.now(timezone.utc) - sport_started_at).total_seconds(), 3),
                    }
                )
            except Exception as exc:
                error = exception_debug(exc)
                error["sport_key"] = sport_key
                report["errors"].append(error)
                sport_report.update(
                    {
                        "status": "error",
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                        "duration_seconds": round((datetime.now(timezone.utc) - sport_started_at).total_seconds(), 3),
                        "error": error,
                    }
                )
            report["sport_results"].append(sport_report)

        if settle and completed_event_ids:
            report["debug_steps"].append({"step": "settle_pending_bets_started", "event_ids": completed_event_ids, "at": now_iso()})
            report["bets_settled"] = settle_pending_bets(db, completed_event_ids)
            report["debug_steps"].append({"step": "settle_pending_bets_done", "bets_settled": report["bets_settled"], "at": now_iso()})

        if report["errors"] and report["events_completed"]:
            report["status"] = "partial_success"
        elif report["errors"] and not report["events_completed"]:
            report["status"] = "error"
    except Exception as exc:
        report["status"] = "error"
        report["errors"].append(exception_debug(exc))
    finally:
        error_message = "; ".join(error["message"] for error in report["errors"])[:1000] or None
        try:
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
            report["debug_steps"].append({"step": "settlement_run_updated", "at": now_iso()})
        except Exception as exc:
            report["status"] = "error"
            report["errors"].append({"stage": "settlement_run_update", **exception_debug(exc)})

    latest = first(db.select("settlement_runs", {"select": "*", "id": f"eq.{run['id']}", "limit": "1"}))
    return {**report, "run": latest}


def manual_result_and_settle(
    db: SupabaseRestClient,
    admin_user: dict[str, Any],
    event_id: str,
    home_score: int,
    away_score: int,
    result_note: str | None = None,
) -> dict[str, Any]:
    event = first(db.select("events", {"select": "*", "id": f"eq.{event_id}", "limit": "1"}))
    if not event:
        raise AppError("event_not_found", "Event not found", 404)

    winner = result_winner(home_score, away_score)
    note = clean_result_note(result_note)
    updated = first(
        db.update(
            "events",
            {
                "home_score": home_score,
                "away_score": away_score,
                "result_winner": winner,
                "result_note": note,
                "result_payload": {"manual": True, "admin_tg_id": admin_user.get("tg_id"), "result_note": note},
                "result_last_update": now_iso(),
                "settled_at": now_iso(),
                "status": "finished",
                "updated_at": now_iso(),
            },
            {"id": f"eq.{event_id}"},
        )
    )
    settle_event_selections(db, event_id, winner, home_score, away_score)
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
                "result_note": infer_result_note(score_event),
                "result_payload": score_event,
                "result_last_update": now_iso(),
                "settled_at": now_iso(),
                "status": "finished" if winner != "unknown" else "cancelled",
                "updated_at": now_iso(),
            },
            {"id": f"eq.{event['id']}"},
        )
    )
    settle_event_selections(db, event["id"], winner, home_score, away_score)
    return updated


def settle_event_selections(
    db: SupabaseRestClient,
    event_id: str,
    winner: str,
    home_score: int | None = None,
    away_score: int | None = None,
) -> None:
    selections = db.select("bet_selections", {"select": "*", "event_id": f"eq.{event_id}", "result_status": "eq.pending"})
    for selection in selections:
        status = selection_result_status(selection, winner, home_score, away_score)
        db.update("bet_selections", {"result_status": status}, {"id": f"eq.{selection['id']}"})


def selection_result_status(selection: dict[str, Any], winner: str, home_score: int | None, away_score: int | None) -> str:
    if winner not in {"home_win", "draw", "away_win"} or home_score is None or away_score is None:
        return "refund"

    market_key = selection.get("market_key") or "h2h"
    selection_key = selection["selection_key"]

    if market_key in {"h2h", "h2h_3_way"}:
        return "won" if selection_key == winner else "lost"

    if market_key == "double_chance":
        wins = {
            "home_or_draw": {"home_win", "draw"},
            "home_or_away": {"home_win", "away_win"},
            "draw_or_away": {"draw", "away_win"},
        }
        return "won" if winner in wins.get(selection_key, set()) else "lost"

    if is_total_market_key(market_key):
        line = selection_line(selection_key)
        if line is None:
            return "refund"
        total = home_score + away_score
        if total == line:
            return "refund"
        if selection_key.startswith("total_over"):
            return "won" if total > line else "lost"
        if selection_key.startswith("total_under"):
            return "won" if total < line else "lost"

    if is_spread_market_key(market_key):
        line = selection_line(selection_key)
        if line is None:
            return "refund"
        if selection_key.startswith("handicap_home"):
            score = home_score + line - away_score
        elif selection_key.startswith("handicap_away"):
            score = away_score + line - home_score
        else:
            return "refund"
        if score == 0:
            return "refund"
        return "won" if score > 0 else "lost"

    return "refund"


def is_total_market_key(market_key: str) -> bool:
    return market_key == "totals" or market_key.startswith("alternate_totals")


def is_spread_market_key(market_key: str) -> bool:
    return market_key == "spreads" or market_key.startswith("alternate_spreads")


def selection_line(selection_key: str) -> float | None:
    marker = selection_key.rsplit("_", 1)[-1]
    if not marker:
        return None
    sign = -1 if marker.startswith("m") else 1
    raw = marker[1:] if marker[:1] in {"m", "p"} else marker
    try:
        return sign * float(raw.replace("p", "."))
    except ValueError:
        return None


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


def clean_result_note(value: str | None) -> str | None:
    note = str(value or "").strip().lower()
    if note in {"ot", "overtime", "овертайм", "от"}:
        return "ot"
    if note in {"so", "shootout", "буллиты", "б"}:
        return "so"
    if note in {"regulation", "regular", "main", "основное"}:
        return "regular"
    return None


def infer_result_note(score_event: dict[str, Any]) -> str | None:
    value = str(score_event.get("result_note") or score_event.get("period") or score_event.get("end_period") or "").lower()
    return clean_result_note(value)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def exception_debug(exc: Exception) -> dict[str, Any]:
    return {
        "type": exc.__class__.__name__,
        "message": str(exc),
        "traceback": "".join(format_exception(type(exc), exc, exc.__traceback__))[-5000:],
    }
