from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from lib.errors import AppError
from lib.supabase_client import SupabaseRestClient
from lib.users import first


MAX_SELECTIONS = 10
MIN_BET_AMOUNT = 30


def place_bet(
    db: SupabaseRestClient,
    user: dict[str, Any],
    amount: float,
    selections: list[dict[str, Any]],
) -> dict[str, Any]:
    if amount < MIN_BET_AMOUNT:
        raise AppError("invalid_amount", f"Минимальная ставка {MIN_BET_AMOUNT} ✦", 400)
    if not selections:
        raise AppError("empty_selections", "Select at least one outcome", 400)
    if len(selections) > MAX_SELECTIONS:
        raise AppError("too_many_selections", f"Maximum selections is {MAX_SELECTIONS}", 400)

    event_ids = [selection.get("event_id") for selection in selections if selection.get("event_id")]
    if len(event_ids) != len(selections):
        raise AppError("invalid_selection", "Each selection must have event_id", 400)
    if len(set(event_ids)) != len(event_ids):
        raise AppError("duplicate_event", "Only one outcome per event is allowed", 400)

    wallet = first(db.select("wallets", {"select": "*", "user_id": f"eq.{user['id']}", "currency": "eq.DEMO", "limit": "1"}))
    if not wallet:
        raise AppError("wallet_not_found", "Wallet not found", 404)

    balance_before = float(wallet["balance"])
    if balance_before < amount:
        raise AppError("insufficient_balance", "Недостаточный баланс", 400)

    snapshots = [validate_selection(db, selection) for selection in selections]
    total_odds = round(product(snapshot["price"] for snapshot in snapshots), 2)
    possible_win = round(amount * total_odds, 2)
    bet_type = "single" if len(snapshots) == 1 else "express"
    balance_after = round(balance_before - amount, 2)

    updated_wallet = first(
        db.update(
            "wallets",
            {"balance": balance_after, "updated_at": datetime.now(timezone.utc).isoformat()},
            {"id": f"eq.{wallet['id']}"},
        )
    )
    if not updated_wallet:
        raise AppError("wallet_update_failed", "Could not update wallet", 500)

    bet = first(
        db.insert(
            "bets",
            {
                "user_id": user["id"],
                "tg_id": user["tg_id"],
                "amount": amount,
                "total_odds": total_odds,
                "possible_win": possible_win,
                "status": "pending",
                "bet_type": bet_type,
            },
        )
    )
    if not bet:
        raise AppError("bet_create_failed", "Could not create bet", 500)

    db.insert("bet_selections", [{**snapshot["selection_payload"], "bet_id": bet["id"]} for snapshot in snapshots])
    db.insert(
        "wallet_transactions",
        {
            "user_id": user["id"],
            "wallet_id": wallet["id"],
            "type": "bet_place",
            "amount": -amount,
            "balance_before": balance_before,
            "balance_after": balance_after,
            "related_bet_id": bet["id"],
            "metadata": {"selections": selections, "bet_type": bet_type},
        },
    )

    return {"bet": bet, "wallet": updated_wallet}


def validate_selection(db: SupabaseRestClient, selection: dict[str, Any]) -> dict[str, Any]:
    event_id = selection.get("event_id", "")
    bookmaker_key = selection.get("bookmaker_key", "")
    market_key = selection.get("market_key") or "h2h"
    selection_key = selection.get("selection_key", "")

    event = first(db.select("events", {"select": "*", "id": f"eq.{event_id}", "limit": "1"}))
    if not event:
        raise AppError("event_not_found", "Event not found", 404)

    starts_at = parse_iso(event["commence_time"])
    if event["status"] != "upcoming" or starts_at <= datetime.now(timezone.utc) + timedelta(minutes=2):
        raise AppError("event_closed", "Betting for this event is closed", 400)

    odd = first(
        db.select(
            "odds_current",
            {
                "select": "*",
                "event_id": f"eq.{event_id}",
                "bookmaker_key": f"eq.{bookmaker_key}",
                "market_key": f"eq.{market_key}",
                "selection_key": f"eq.{selection_key}",
                "limit": "1",
            },
        )
    )
    if not odd or float(odd["price"]) <= 1:
        raise AppError("odds_not_found", "Odds are not available", 404)

    home_team = find_team(db, event.get("home_team_id"))
    away_team = find_team(db, event.get("away_team_id"))
    home_name = (home_team or {}).get("name_ru") or event["home_team_raw"]
    away_name = (away_team or {}).get("name_ru") or event["away_team_raw"]
    selection_name_ru = selection_name_for_key(selection_key, odd, home_name, away_name)
    price = float(odd["price"])

    return {
        "price": price,
        "selection_payload": {
            "event_id": event["id"],
            "bookmaker_key": bookmaker_key,
            "market_key": market_key,
            "selection_key": selection_key,
            "selection_name_raw": odd["selection_name_raw"],
            "selection_name_ru": selection_name_ru,
            "price": price,
            "event_name_ru": f"{home_name} — {away_name}",
            "home_team_name_ru": home_name,
            "away_team_name_ru": away_name,
            "commence_time": event["commence_time"],
        },
    }


def get_user_bets(db: SupabaseRestClient, user: dict[str, Any]) -> list[dict[str, Any]]:
    bets = db.select(
        "bets",
        {
            "select": "*",
            "user_id": f"eq.{user['id']}",
            "order": "created_at.desc",
            "limit": "50",
        },
    )
    if not bets:
        return []

    bet_ids = [bet["id"] for bet in bets]
    selections = db.select("bet_selections", {"select": "*", "bet_id": f"in.({','.join(bet_ids)})", "order": "created_at.asc"})
    event_ids = sorted({selection["event_id"] for selection in selections if selection.get("event_id")})
    events_by_id: dict[str, dict[str, Any]] = {}
    teams_by_id: dict[str, dict[str, Any]] = {}
    if event_ids:
        events = db.select("events", {"select": "*", "id": f"in.({','.join(event_ids)})", "limit": "200"})
        events_by_id = {event["id"]: event for event in events}
        team_ids = sorted(
            {
                team_id
                for event in events
                for team_id in (event.get("home_team_id"), event.get("away_team_id"))
                if team_id
            }
        )
        if team_ids:
            teams_by_id = {
                team["id"]: team
                for team in db.select("teams", {"select": "*", "id": f"in.({','.join(team_ids)})", "limit": "400"})
            }

    by_bet: dict[str, list[dict[str, Any]]] = {}
    for selection in selections:
        item = dict(selection)
        item["price"] = float(item["price"])
        enrich_selection_with_event(item, events_by_id, teams_by_id)
        by_bet.setdefault(selection["bet_id"], []).append(item)

    result = []
    for bet in bets:
        item = dict(bet)
        item["amount"] = float(item["amount"])
        item["total_odds"] = float(item["total_odds"])
        item["possible_win"] = float(item["possible_win"])
        item["payout"] = float(item["payout"]) if item.get("payout") is not None else None
        item["selections"] = by_bet.get(bet["id"], [])
        result.append(item)

    return result


def manual_settle_admin_bet(
    db: SupabaseRestClient,
    admin_user: dict[str, Any],
    bet_id: str,
    status: str,
    payout: float | None = None,
) -> dict[str, Any]:
    bet = first(db.select("bets", {"select": "*", "id": f"eq.{bet_id}", "limit": "1"}))
    if not bet:
        raise AppError("bet_not_found", "Ставка не найдена", 404)
    if bet.get("status") != "pending":
        raise AppError("bet_already_settled", "Ставка уже рассчитана", 400)
    if status not in {"won", "lost", "refund", "cancelled"}:
        raise AppError("invalid_bet_status", "Выберите корректный статус", 400)

    amount = float(bet["amount"])
    if payout is None:
        if status == "won":
            payout = float(bet.get("possible_win") or 0)
        elif status == "refund":
            payout = amount
        else:
            payout = 0.0
    try:
        payout = round(float(payout), 2)
    except (TypeError, ValueError) as exc:
        raise AppError("invalid_payout", "Выплата должна быть числом", 400) from exc
    if payout < 0:
        raise AppError("invalid_payout", "Выплата не может быть отрицательной", 400)

    claimed = db.update(
        "bets",
        {
            "status": status,
            "payout": payout,
            "settlement_note": f"admin_manual:{admin_user.get('tg_id')}",
            "settled_at": datetime.now(timezone.utc).isoformat(),
        },
        {"id": f"eq.{bet_id}", "status": "eq.pending"},
    )
    if not claimed:
        raise AppError("bet_already_settled", "Ставка уже рассчитана", 400)

    selection_status = {"won": "won", "lost": "lost", "refund": "refund", "cancelled": "refund"}[status]
    db.update("bet_selections", {"result_status": selection_status}, {"bet_id": f"eq.{bet_id}", "result_status": "eq.pending"}, return_rows=False)

    updated_bet = first(claimed) or {**bet, "status": status, "payout": payout}
    if status == "won" and payout > 0:
        credit_wallet(db, bet, payout, "bet_win")
    elif status == "refund" and payout > 0:
        credit_wallet(db, bet, payout, "bet_refund")
    elif status == "lost":
        record_loss(db, bet)

    return {"bet": updated_bet}


def delete_admin_bet(db: SupabaseRestClient, admin_user: dict[str, Any], bet_id: str) -> dict[str, Any]:
    bet = first(db.select("bets", {"select": "*", "id": f"eq.{bet_id}", "limit": "1"}))
    if not bet:
        raise AppError("bet_not_found", "Ставка не найдена", 404)

    refunded = False
    if bet.get("status") == "pending":
        credit_wallet(db, bet, float(bet["amount"]), "bet_refund")
        refunded = True

    db.update("wallet_transactions", {"related_bet_id": None}, {"related_bet_id": f"eq.{bet_id}"}, return_rows=False)
    db.delete("bet_selections", {"bet_id": f"eq.{bet_id}"})
    deleted = db.delete("bets", {"id": f"eq.{bet_id}"})
    return {"deleted": True, "refunded": refunded, "bet": first(deleted) or bet}


def enrich_selection_with_event(
    selection: dict[str, Any],
    events_by_id: dict[str, dict[str, Any]],
    teams_by_id: dict[str, dict[str, Any]],
) -> None:
    event = events_by_id.get(selection.get("event_id"))
    if not event:
        return

    home_team = teams_by_id.get(event.get("home_team_id"))
    away_team = teams_by_id.get(event.get("away_team_id"))
    home_name = (home_team or {}).get("name_ru") or selection.get("home_team_name_ru") or event.get("home_team_raw")
    away_name = (away_team or {}).get("name_ru") or selection.get("away_team_name_ru") or event.get("away_team_raw")

    selection.update(
        {
            "event_status": event.get("status"),
            "home_score": event.get("home_score"),
            "away_score": event.get("away_score"),
            "result_winner": event.get("result_winner"),
            "result_note": event.get("result_note"),
            "settled_at": event.get("settled_at"),
            "home_team_name_ru": home_name,
            "away_team_name_ru": away_name,
            "home_team_logo_url": (home_team or {}).get("logo_url"),
            "away_team_logo_url": (away_team or {}).get("logo_url"),
        }
    )
    selection["event_name_ru"] = selection.get("event_name_ru") or f"{home_name} — {away_name}"


def selection_name_for_key(selection_key: str, odd: dict[str, Any], home_name: str, away_name: str) -> str:
    if selection_key == "home_win":
        return home_name
    if selection_key == "away_win":
        return away_name
    if selection_key == "draw":
        return "Ничья"
    return odd.get("selection_name_ru") or odd["selection_name_raw"]


def find_team(db: SupabaseRestClient, team_id: str | None) -> dict[str, Any] | None:
    if not team_id:
        return None
    return first(db.select("teams", {"select": "*", "id": f"eq.{team_id}", "limit": "1"}))


def product(values) -> float:
    result = 1.0
    for value in values:
        result *= float(value)
    return result


def parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed
