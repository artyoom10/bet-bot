from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Any

from lib.errors import AppError
from lib.supabase_client import SupabaseRestClient
from lib.users import first


LEAGUE_TIERS = [
    {"threshold": 0, "title": "Новичок"},
    {"threshold": 500, "title": "Игрок"},
    {"threshold": 1000, "title": "Аналитик"},
    {"threshold": 2500, "title": "Рисковый"},
    {"threshold": 5000, "title": "Профи"},
    {"threshold": 10000, "title": "Акула"},
    {"threshold": 25000, "title": "Магнат"},
    {"threshold": 50000, "title": "Легенда"},
    {"threshold": 100000, "title": "Босс"},
]

REWARD_STEPS = [
    {"threshold": 100, "title": "Новичок", "stars": 100, "wheel_type": None},
    {"threshold": 500, "title": "Игрок", "stars": 0, "wheel_type": "small"},
    {"threshold": 1000, "title": "Аналитик", "stars": 250, "wheel_type": None},
    {"threshold": 2500, "title": "Рисковый", "stars": 0, "wheel_type": "standard"},
    {"threshold": 5000, "title": "Профи", "stars": 500, "wheel_type": None},
    {"threshold": 10000, "title": "Акула", "stars": 0, "wheel_type": "large"},
    {"threshold": 25000, "title": "Магнат", "stars": 1000, "wheel_type": None},
    {"threshold": 50000, "title": "Легенда", "stars": 0, "wheel_type": "elite"},
    {"threshold": 100000, "title": "Босс", "stars": 2500, "wheel_type": None},
]

WHEELS = {
    "small": {
        "title": "Малое колесо",
        "segments": [
            {"stars": 50, "weight": 38},
            {"stars": 100, "weight": 30},
            {"stars": 150, "weight": 18},
            {"stars": 200, "weight": 10},
            {"stars": 300, "weight": 4},
        ],
    },
    "standard": {
        "title": "Обычное колесо",
        "segments": [
            {"stars": 100, "weight": 40},
            {"stars": 250, "weight": 30},
            {"stars": 500, "weight": 18},
            {"stars": 750, "weight": 8},
            {"stars": 1000, "weight": 4},
        ],
    },
    "large": {
        "title": "Большое колесо",
        "segments": [
            {"stars": 500, "weight": 42},
            {"stars": 1000, "weight": 30},
            {"stars": 1500, "weight": 16},
            {"stars": 2500, "weight": 9},
            {"stars": 5000, "weight": 3},
        ],
    },
    "elite": {
        "title": "Элитное колесо",
        "segments": [
            {"stars": 1000, "weight": 44},
            {"stars": 2500, "weight": 28},
            {"stars": 5000, "weight": 17},
            {"stars": 7500, "weight": 8},
            {"stars": 10000, "weight": 3},
        ],
    },
}


def get_league_payload(db: SupabaseRestClient, user: dict[str, Any]) -> dict[str, Any]:
    stats = calculate_user_stats(db, user["id"])
    tier = tier_for_total(stats["total_win"])
    next_tier = next_tier_for_total(stats["total_win"])
    sync_user_title(db, user, tier["title"])

    claimed_rows = db.select(
        "user_league_rewards",
        {"select": "*", "user_id": f"eq.{user['id']}", "limit": "100"},
    )
    claimed_by_threshold = {int(row["threshold"]): row for row in claimed_rows}
    pending_spins = db.select(
        "fortune_wheel_spins",
        {
            "select": "*",
            "user_id": f"eq.{user['id']}",
            "status": "eq.available",
            "order": "created_at.asc",
            "limit": "20",
        },
    )
    leaderboard = build_leaderboard(db)

    return {
        "current": {
            **stats,
            "title": tier["title"],
            "league": tier["title"],
            "threshold": tier["threshold"],
            "next_title": next_tier["title"] if next_tier else None,
            "next_threshold": next_tier["threshold"] if next_tier else None,
            "remaining": max(0, (next_tier["threshold"] - stats["total_win"]) if next_tier else 0),
            "progress_percent": progress_percent(stats["total_win"], tier, next_tier),
            "rank": leaderboard_rank(leaderboard, user["id"], stats["total_win"]),
        },
        "tiers": tiers_payload(),
        "rewards": rewards_payload(stats["total_win"], claimed_by_threshold),
        "wheels": public_wheels(),
        "pending_wheels": [spin_payload(spin) for spin in pending_spins],
        "leaderboard": leaderboard[:10],
    }


def claim_league_reward(db: SupabaseRestClient, user: dict[str, Any], threshold: int) -> dict[str, Any]:
    step = next((item for item in REWARD_STEPS if item["threshold"] == threshold), None)
    if not step:
        raise AppError("reward_not_found", "Награда не найдена", 404)

    stats = calculate_user_stats(db, user["id"])
    if stats["total_win"] < threshold:
        raise AppError("reward_not_available", "Награда ещё недоступна", 400)

    existing = first(
        db.select(
            "user_league_rewards",
            {"select": "id", "user_id": f"eq.{user['id']}", "threshold": f"eq.{threshold}", "limit": "1"},
        )
    )
    if existing:
        raise AppError("reward_already_claimed", "Награда уже получена", 400)

    db.insert(
        "user_league_rewards",
        {
            "user_id": user["id"],
            "threshold": threshold,
            "title": step["title"],
            "stars_amount": step["stars"],
            "wheel_type": step["wheel_type"],
        },
    )
    if step["stars"]:
        credit_wallet(db, user["id"], float(step["stars"]), "league_reward", {"threshold": threshold})
    if step["wheel_type"]:
        db.insert(
            "fortune_wheel_spins",
            {
                "user_id": user["id"],
                "wheel_type": step["wheel_type"],
                "source_threshold": threshold,
                "status": "available",
            },
        )

    tier = tier_for_total(stats["total_win"])
    sync_user_title(db, user, tier["title"])
    return get_league_payload(db, {**user, "client_status": tier["title"]})


def spin_fortune_wheel(db: SupabaseRestClient, user: dict[str, Any], spin_id: str) -> dict[str, Any]:
    spin = first(
        db.select(
            "fortune_wheel_spins",
            {
                "select": "*",
                "id": f"eq.{spin_id}",
                "user_id": f"eq.{user['id']}",
                "status": "eq.available",
                "limit": "1",
            },
        )
    )
    if not spin:
        raise AppError("wheel_spin_not_found", "Доступное колесо не найдено", 404)

    wheel_type = spin["wheel_type"]
    if wheel_type not in WHEELS:
        raise AppError("wheel_type_not_supported", "Тип колеса не поддерживается", 400)

    prize = weighted_prize(wheel_type)
    updated = first(
        db.update(
            "fortune_wheel_spins",
            {
                "status": "spun",
                "prize_amount": prize,
                "spun_at": now_iso(),
            },
            {"id": f"eq.{spin_id}", "status": "eq.available"},
        )
    )
    if not updated:
        raise AppError("wheel_spin_already_used", "Колесо уже использовано", 400)

    credit_wallet(db, user["id"], float(prize), "wheel_prize", {"spin_id": spin_id, "wheel_type": wheel_type})
    return {"prize": prize, "spin": spin_payload(updated), "league": get_league_payload(db, user)}


def calculate_user_stats(db: SupabaseRestClient, user_id: str) -> dict[str, Any]:
    win_rows = db.select(
        "wallet_transactions",
        {
            "select": "amount",
            "user_id": f"eq.{user_id}",
            "type": "eq.bet_win",
            "limit": "1000",
        },
    )
    lost_bets = db.select(
        "bets",
        {
            "select": "amount",
            "user_id": f"eq.{user_id}",
            "status": "eq.lost",
            "limit": "1000",
        },
    )
    spun = db.select(
        "fortune_wheel_spins",
        {"select": "id", "user_id": f"eq.{user_id}", "status": "eq.spun", "limit": "1000"},
    )
    wins = [float(row.get("amount") or 0) for row in win_rows if float(row.get("amount") or 0) > 0]
    losses = [float(row.get("amount") or 0) for row in lost_bets if float(row.get("amount") or 0) > 0]
    return {
        "total_win": round(sum(wins), 2),
        "biggest_win": round(max(wins), 2) if wins else 0,
        "biggest_loss": round(max(losses), 2) if losses else 0,
        "wheel_spins_count": len(spun),
    }


def build_leaderboard(db: SupabaseRestClient) -> list[dict[str, Any]]:
    tx_rows = db.select(
        "wallet_transactions",
        {"select": "user_id,amount", "type": "eq.bet_win", "limit": "5000"},
    )
    totals: dict[str, float] = {}
    for row in tx_rows:
        user_id = row.get("user_id")
        amount = float(row.get("amount") or 0)
        if user_id and amount > 0:
            totals[user_id] = totals.get(user_id, 0) + amount
    if not totals:
        return []

    user_ids = list(totals.keys())[:200]
    users = db.select(
        "users",
        {
            "select": "id,username,first_name,last_name,client_status",
            "id": f"in.({','.join(user_ids)})",
            "limit": "200",
        },
    )
    users_by_id = {row["id"]: row for row in users}
    rows = []
    for user_id, total in totals.items():
        profile = users_by_id.get(user_id)
        if not profile:
            continue
        tier = tier_for_total(total)
        rows.append(
            {
                "user_id": user_id,
                "name": display_name(profile),
                "title": tier["title"],
                "total_win": round(total, 2),
            }
        )
    rows.sort(key=lambda item: item["total_win"], reverse=True)
    return [{**item, "rank": index + 1} for index, item in enumerate(rows) if item["total_win"] >= 500]


def tier_for_total(total_win: float) -> dict[str, Any]:
    current = LEAGUE_TIERS[0]
    for tier in LEAGUE_TIERS:
        if total_win >= tier["threshold"]:
            current = tier
    return current


def next_tier_for_total(total_win: float) -> dict[str, Any] | None:
    return next((tier for tier in LEAGUE_TIERS if total_win < tier["threshold"]), None)


def sync_user_title(db: SupabaseRestClient, user: dict[str, Any], title: str) -> None:
    if user.get("id") and user.get("client_status") != title:
        db.update("users", {"client_status": title, "updated_at": now_iso()}, {"id": f"eq.{user['id']}"}, return_rows=False)


def credit_wallet(db: SupabaseRestClient, user_id: str, amount: float, transaction_type: str, metadata: dict[str, Any]) -> None:
    wallet = first(db.select("wallets", {"select": "*", "user_id": f"eq.{user_id}", "currency": "eq.DEMO", "limit": "1"}))
    if not wallet:
        raise AppError("wallet_not_found", "Кошелёк не найден", 404)
    balance_before = float(wallet["balance"])
    balance_after = round(balance_before + amount, 2)
    db.update("wallets", {"balance": balance_after, "updated_at": now_iso()}, {"id": f"eq.{wallet['id']}"}, return_rows=False)
    db.insert(
        "wallet_transactions",
        {
            "user_id": user_id,
            "wallet_id": wallet["id"],
            "type": transaction_type,
            "amount": amount,
            "balance_before": balance_before,
            "balance_after": balance_after,
            "metadata": metadata,
        },
    )


def weighted_prize(wheel_type: str) -> int:
    segments = WHEELS[wheel_type]["segments"]
    total_weight = sum(item["weight"] for item in segments)
    pick = random.uniform(0, total_weight)
    cursor = 0.0
    for segment in segments:
        cursor += segment["weight"]
        if pick <= cursor:
            return int(segment["stars"])
    return int(segments[-1]["stars"])


def progress_percent(total_win: float, tier: dict[str, Any], next_tier: dict[str, Any] | None) -> float:
    if not next_tier:
        return 100
    span = max(1, next_tier["threshold"] - tier["threshold"])
    return round(min(100, max(0, (total_win - tier["threshold"]) / span * 100)), 1)


def rewards_payload(total_win: float, claimed_by_threshold: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for step in REWARD_STEPS:
        claimed = claimed_by_threshold.get(step["threshold"])
        wheel_type = step["wheel_type"]
        rows.append(
            {
                **step,
                "wheel_title": WHEELS[wheel_type]["title"] if wheel_type else None,
                "claimed": bool(claimed),
                "claimed_at": claimed.get("claimed_at") if claimed else None,
                "eligible": total_win >= step["threshold"],
                "claimable": total_win >= step["threshold"] and not claimed,
            }
        )
    return rows


def tiers_payload() -> list[dict[str, Any]]:
    return [
        {
            **tier,
            "next_threshold": LEAGUE_TIERS[index + 1]["threshold"] if index + 1 < len(LEAGUE_TIERS) else None,
        }
        for index, tier in enumerate(LEAGUE_TIERS)
    ]


def public_wheels() -> dict[str, Any]:
    result = {}
    for key, wheel in WHEELS.items():
        total = sum(item["weight"] for item in wheel["segments"])
        result[key] = {
            "title": wheel["title"],
            "segments": [
                {"stars": item["stars"], "chance_percent": round(item["weight"] / total * 100, 1)}
                for item in wheel["segments"]
            ],
        }
    return result


def spin_payload(spin: dict[str, Any]) -> dict[str, Any]:
    wheel_type = spin.get("wheel_type")
    return {
        "id": spin.get("id"),
        "wheel_type": wheel_type,
        "wheel_title": WHEELS.get(wheel_type, {}).get("title", wheel_type),
        "source_threshold": spin.get("source_threshold"),
        "status": spin.get("status"),
        "prize_amount": spin.get("prize_amount"),
        "created_at": spin.get("created_at"),
        "spun_at": spin.get("spun_at"),
    }


def leaderboard_rank(leaderboard: list[dict[str, Any]], user_id: str, total_win: float) -> int | None:
    for row in leaderboard:
        if row["user_id"] == user_id:
            return row["rank"]
    if total_win <= 0:
        return None
    return 1 + sum(1 for row in leaderboard if row["total_win"] > total_win)


def display_name(user: dict[str, Any]) -> str:
    return " ".join([item for item in [user.get("first_name"), user.get("last_name")] if item]) or user.get("username") or "Игрок"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
