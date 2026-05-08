from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Any

from lib.errors import AppError
from lib.supabase_client import SupabaseRestClient
from lib.users import first


MOSCOW_TZ = timezone(timedelta(hours=3))
RANK_LOGO_BASE_URL = "https://mzyxhpnkvdloulcxidpn.supabase.co/storage/v1/object/public/ranks"

LEAGUE_TIERS = [
    {"threshold": 0, "title": "Железо", "logo_url": f"{RANK_LOGO_BASE_URL}/rank_1.png"},
    {"threshold": 2500, "title": "Бронза", "logo_url": f"{RANK_LOGO_BASE_URL}/rank_2.png"},
    {"threshold": 7500, "title": "Серебро", "logo_url": f"{RANK_LOGO_BASE_URL}/rank_3.png"},
    {"threshold": 15000, "title": "Золото", "logo_url": f"{RANK_LOGO_BASE_URL}/rank_4.png"},
    {"threshold": 30000, "title": "Платина", "logo_url": f"{RANK_LOGO_BASE_URL}/rank_5.png"},
    {"threshold": 50000, "title": "Изумруд", "logo_url": f"{RANK_LOGO_BASE_URL}/rank_6.png"},
    {"threshold": 80000, "title": "Сапфир", "logo_url": f"{RANK_LOGO_BASE_URL}/rank_7.png"},
    {"threshold": 125000, "title": "Рубин", "logo_url": f"{RANK_LOGO_BASE_URL}/rank_8.png"},
    {"threshold": 200000, "title": "Алмаз", "logo_url": f"{RANK_LOGO_BASE_URL}/rank_9.png"},
]

BONUS_REWARD_STEPS = [
    {"threshold": 100, "kind": "stars", "stars": 100, "wheel_type": None, "title": None},
    {"threshold": 500, "kind": "wheel", "stars": 0, "wheel_type": "small", "title": None},
    {"threshold": 1000, "kind": "stars", "stars": 250, "wheel_type": None, "title": None},
    {"threshold": 2500, "kind": "wheel", "stars": 0, "wheel_type": "standard", "title": None},
    {"threshold": 5000, "kind": "stars", "stars": 500, "wheel_type": None, "title": None},
    {"threshold": 10000, "kind": "wheel", "stars": 0, "wheel_type": "large", "title": None},
    {"threshold": 25000, "kind": "stars", "stars": 1000, "wheel_type": None, "title": None},
    {"threshold": 50000, "kind": "wheel", "stars": 0, "wheel_type": "elite", "title": None},
    {"threshold": 100000, "kind": "stars", "stars": 2500, "wheel_type": None, "title": None},
]

DAILY_REWARDS = [100, 150, 200, 250, 300, 350, 500]

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
    tier = tier_for_total(stats["total_profit"])
    next_tier = next_tier_for_total(stats["total_profit"])
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
    if user.get("is_admin"):
        pending_spins = [admin_wheel_spin(wheel_type) for wheel_type in WHEELS] + pending_spins
    leaderboards = build_leaderboards(db)
    leaderboard = leaderboards["overall"]

    return {
        "current": {
            **stats,
            "title": tier["title"],
            "league": tier["title"],
            "rank_logo_url": tier.get("logo_url"),
            "threshold": tier["threshold"],
            "next_title": next_tier["title"] if next_tier else None,
            "next_threshold": next_tier["threshold"] if next_tier else None,
            "remaining": max(0, (next_tier["threshold"] - stats["total_profit"]) if next_tier else 0),
            "progress_percent": progress_percent(stats["total_profit"], tier, next_tier),
            "rank": leaderboard_rank(leaderboard, user["id"], stats["total_profit"]),
        },
        "tiers": tiers_payload(),
        "rewards": rewards_payload(stats["total_profit"], claimed_by_threshold),
        "daily_reward": daily_reward_payload(db, user["id"]),
        "wheels": public_wheels(),
        "pending_wheels": [spin_payload(spin) for spin in pending_spins],
        "leaderboard": leaderboard[:50],
        "leaderboards": {key: rows[:50] for key, rows in leaderboards.items()},
    }


def claim_league_reward(db: SupabaseRestClient, user: dict[str, Any], threshold: int) -> dict[str, Any]:
    step = next((item for item in BONUS_REWARD_STEPS if item["threshold"] == threshold), None)
    if not step:
        raise AppError("reward_not_found", "Награда не найдена", 404)

    stats = calculate_user_stats(db, user["id"])
    if stats["total_profit"] < threshold:
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
            "title": step["kind"],
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

    tier = tier_for_total(stats["total_profit"])
    sync_user_title(db, user, tier["title"])
    return get_league_payload(db, {**user, "client_status": tier["title"]})


def claim_daily_reward(db: SupabaseRestClient, user: dict[str, Any]) -> dict[str, Any]:
    daily = daily_reward_payload(db, user["id"])
    if not daily["available"]:
        raise AppError("daily_reward_unavailable", "Ежедневная награда уже получена", 400)

    day = int(daily["next_day"])
    amount = DAILY_REWARDS[day - 1]
    db.insert(
        "daily_login_rewards",
        {
            "user_id": user["id"],
            "reward_date": daily["today"],
            "streak_day": day,
            "stars_amount": amount,
        },
    )
    credit_wallet(db, user["id"], float(amount), "daily_login_reward", {"streak_day": day, "reward_date": daily["today"]})
    return get_league_payload(db, user)


def spin_fortune_wheel(db: SupabaseRestClient, user: dict[str, Any], spin_id: str) -> dict[str, Any]:
    if spin_id.startswith("admin:") and user.get("is_admin"):
        wheel_type = spin_id.split(":", 1)[1]
        if wheel_type not in WHEELS:
            raise AppError("wheel_type_not_supported", "Тип колеса не поддерживается", 400)
        prize = weighted_prize(wheel_type)
        credit_wallet(db, user["id"], float(prize), "wheel_prize", {"spin_id": spin_id, "wheel_type": wheel_type, "admin_unlimited": True})
        return {"prize": prize, "spin": spin_payload(admin_wheel_spin(wheel_type) | {"status": "spun", "prize_amount": prize}), "league": get_league_payload(db, user)}

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
    won_bets = db.select(
        "bets",
        {
            "select": "amount,payout,possible_win,total_odds",
            "user_id": f"eq.{user_id}",
            "status": "eq.won",
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
    profits = [bet_profit(row) for row in won_bets]
    odds = [float(row.get("total_odds") or 0) for row in won_bets if float(row.get("total_odds") or 0) > 0]
    losses = [float(row.get("amount") or 0) for row in lost_bets if float(row.get("amount") or 0) > 0]
    total_profit = round(sum(profits), 2)
    return {
        "total_profit": total_profit,
        "total_win": total_profit,
        "biggest_win": round(max(profits), 2) if profits else 0,
        "biggest_loss": round(max(losses), 2) if losses else 0,
        "biggest_win_odds": round(max(odds), 2) if odds else 0,
        "wheel_spins_count": len(spun),
    }


def build_leaderboard(db: SupabaseRestClient) -> list[dict[str, Any]]:
    return build_leaderboards(db)["overall"]


def build_leaderboards(db: SupabaseRestClient) -> dict[str, list[dict[str, Any]]]:
    users = db.select(
        "users",
        {
            "select": "id,tg_id,username,first_name,last_name,client_status",
            "order": "created_at.asc",
            "limit": "200",
        },
    )
    users = [user for user in users if not str(user.get("tg_id") or "").startswith("deleted:")]
    if not users:
        return {"overall": [], "losers": [], "lucky": []}

    user_ids = [user["id"] for user in users]
    won_bets = db.select(
        "bets",
        {
            "select": "user_id,amount,payout,possible_win,total_odds",
            "status": "eq.won",
            "user_id": f"in.({','.join(user_ids)})",
            "limit": "5000",
        },
    )
    lost_bets = db.select(
        "bets",
        {
            "select": "user_id,amount",
            "status": "eq.lost",
            "user_id": f"in.({','.join(user_ids)})",
            "limit": "5000",
        },
    )
    totals = {user["id"]: 0.0 for user in users}
    biggest_wins = {user["id"]: 0.0 for user in users}
    biggest_losses = {user["id"]: 0.0 for user in users}
    for bet in won_bets:
        user_id = bet.get("user_id")
        if user_id in totals:
            profit = bet_profit(bet)
            totals[user_id] += profit
            biggest_wins[user_id] = max(biggest_wins[user_id], profit)
    for bet in lost_bets:
        user_id = bet.get("user_id")
        if user_id in biggest_losses:
            biggest_losses[user_id] = max(biggest_losses[user_id], float(bet.get("amount") or 0))

    rows = []
    for profile in users:
        total = round(totals.get(profile["id"], 0.0), 2)
        tier = tier_for_total(total)
        rows.append(
            {
                "user_id": profile["id"],
                "name": display_name(profile),
                "title": tier["title"],
                "rank_logo_url": tier.get("logo_url"),
                "total_win": total,
                "total_profit": total,
                "biggest_win": round(biggest_wins.get(profile["id"], 0.0), 2),
                "biggest_loss": round(biggest_losses.get(profile["id"], 0.0), 2),
            }
        )
    overall = sorted(rows, key=lambda item: (-item["total_profit"], item["name"].lower()))
    losers = sorted(rows, key=lambda item: (-item["biggest_loss"], item["name"].lower()))
    lucky = sorted(rows, key=lambda item: (-item["biggest_win"], item["name"].lower()))
    return {
        "overall": [{**item, "rank": index + 1} for index, item in enumerate(overall)],
        "losers": [{**item, "rank": index + 1} for index, item in enumerate(losers)],
        "lucky": [{**item, "rank": index + 1} for index, item in enumerate(lucky)],
    }


def daily_reward_payload(db: SupabaseRestClient, user_id: str) -> dict[str, Any]:
    today = datetime.now(MOSCOW_TZ).date()
    rows = db.select(
        "daily_login_rewards",
        {
            "select": "*",
            "user_id": f"eq.{user_id}",
            "order": "reward_date.desc",
            "limit": "1",
        },
    )
    last = first(rows)
    if not last:
        next_day = 1
        available = True
    else:
        last_date = parse_date(last["reward_date"])
        if last_date == today:
            next_day = int(last.get("streak_day") or 1)
            available = False
        elif last_date == today - timedelta(days=1):
            next_day = min(7, int(last.get("streak_day") or 0) + 1)
            available = True
        else:
            next_day = 1
            available = True

    return {
        "available": available,
        "today": today.isoformat(),
        "next_day": next_day,
        "amount": DAILY_REWARDS[next_day - 1],
        "rewards": [{"day": index + 1, "stars": amount} for index, amount in enumerate(DAILY_REWARDS)],
        "last_claimed_at": last.get("created_at") if last else None,
    }


def tier_for_total(total_profit: float) -> dict[str, Any]:
    current = LEAGUE_TIERS[0]
    for tier in LEAGUE_TIERS:
        if total_profit >= tier["threshold"]:
            current = tier
    return current


def next_tier_for_total(total_profit: float) -> dict[str, Any] | None:
    return next((tier for tier in LEAGUE_TIERS if total_profit < tier["threshold"]), None)


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


def progress_percent(total_profit: float, tier: dict[str, Any], next_tier: dict[str, Any] | None) -> float:
    if not next_tier:
        return 100
    span = max(1, next_tier["threshold"] - tier["threshold"])
    return round(min(100, max(0, (total_profit - tier["threshold"]) / span * 100)), 1)


def rewards_payload(total_profit: float, claimed_by_threshold: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for tier in LEAGUE_TIERS[1:]:
        rows.append(
            {
                "threshold": tier["threshold"],
                "kind": "rank",
                "title": tier["title"],
                "stars": 0,
                "wheel_type": None,
                "wheel_title": None,
                "logo_url": tier.get("logo_url"),
                "claimed": total_profit >= tier["threshold"],
                "eligible": total_profit >= tier["threshold"],
                "claimable": False,
            }
        )
    for step in BONUS_REWARD_STEPS:
        claimed = claimed_by_threshold.get(step["threshold"])
        wheel_type = step["wheel_type"]
        rows.append(
            {
                **step,
                "wheel_title": WHEELS[wheel_type]["title"] if wheel_type else None,
                "claimed": bool(claimed),
                "claimed_at": claimed.get("claimed_at") if claimed else None,
                "eligible": total_profit >= step["threshold"],
                "claimable": total_profit >= step["threshold"] and not claimed,
            }
        )
    rows.sort(key=lambda item: (item["threshold"], 0 if item["kind"] == "rank" else 1))
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
        "unlimited": bool(spin.get("unlimited")),
    }


def leaderboard_rank(leaderboard: list[dict[str, Any]], user_id: str, total_profit: float) -> int | None:
    for row in leaderboard:
        if row["user_id"] == user_id:
            return row["rank"]
    if total_profit <= 0:
        return None
    return 1 + sum(1 for row in leaderboard if row["total_profit"] > total_profit)


def admin_wheel_spin(wheel_type: str) -> dict[str, Any]:
    return {
        "id": f"admin:{wheel_type}",
        "wheel_type": wheel_type,
        "source_threshold": None,
        "status": "available",
        "created_at": None,
        "unlimited": True,
    }


def bet_profit(bet: dict[str, Any]) -> float:
    amount = float(bet.get("amount") or 0)
    payout = float(bet.get("payout") or bet.get("possible_win") or 0)
    return max(0.0, round(payout - amount, 2))


def display_name(user: dict[str, Any]) -> str:
    return " ".join([item for item in [user.get("first_name"), user.get("last_name")] if item]) or user.get("username") or "Игрок"


def parse_date(value: str) -> Any:
    return datetime.fromisoformat(str(value)).date()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
