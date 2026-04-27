from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from lib.errors import AppError
from lib.supabase_client import SupabaseRestClient
from lib.users import first


def place_bet(
    db: SupabaseRestClient,
    user: dict[str, Any],
    event_id: str,
    bookmaker_key: str,
    market_key: str,
    selection_key: str,
    amount: float,
) -> dict[str, Any]:
    if amount <= 0:
        raise AppError("invalid_amount", "Amount must be positive", 400)

    wallet = first(db.select("wallets", {"select": "*", "user_id": f"eq.{user['id']}", "currency": "eq.DEMO", "limit": "1"}))
    if not wallet:
        raise AppError("wallet_not_found", "Wallet not found", 404)

    balance_before = float(wallet["balance"])
    if balance_before < amount:
        raise AppError("insufficient_balance", "Not enough demo balance", 400)

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
                "market_key": f"eq.{market_key or 'h2h'}",
                "selection_key": f"eq.{selection_key}",
                "limit": "1",
            },
        )
    )
    if not odd or float(odd["price"]) <= 1:
        raise AppError("odds_not_found", "Odds are not available", 404)

    price = float(odd["price"])
    possible_win = round(amount * price, 2)
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

    event_name = f"{event['home_team_raw']} — {event['away_team_raw']}"
    bet = first(
        db.insert(
            "bets",
            {
                "user_id": user["id"],
                "tg_id": user["tg_id"],
                "amount": amount,
                "total_odds": price,
                "possible_win": possible_win,
                "status": "pending",
                "bet_type": "single",
            },
        )
    )
    if not bet:
        raise AppError("bet_create_failed", "Could not create bet", 500)

    db.insert(
        "bet_selections",
        {
            "bet_id": bet["id"],
            "event_id": event["id"],
            "bookmaker_key": bookmaker_key,
            "market_key": market_key or "h2h",
            "selection_key": selection_key,
            "selection_name_raw": odd["selection_name_raw"],
            "selection_name_ru": odd.get("selection_name_ru"),
            "price": price,
            "event_name_ru": event_name,
            "home_team_name_ru": event["home_team_raw"],
            "away_team_name_ru": event["away_team_raw"],
            "commence_time": event["commence_time"],
        },
    )

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
            "metadata": {"event_id": event_id, "selection_key": selection_key, "bookmaker_key": bookmaker_key},
        },
    )

    return {"bet": bet, "wallet": updated_wallet}


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
    selections = db.select("bet_selections", {"select": "*", "bet_id": f"in.({','.join(bet_ids)})"})
    by_bet: dict[str, list[dict[str, Any]]] = {}
    for selection in selections:
        by_bet.setdefault(selection["bet_id"], []).append(selection)

    result = []
    for bet in bets:
        item = dict(bet)
        item["amount"] = float(item["amount"])
        item["total_odds"] = float(item["total_odds"])
        item["possible_win"] = float(item["possible_win"])
        item["selections"] = by_bet.get(bet["id"], [])
        result.append(item)

    return result


def parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed
