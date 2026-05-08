from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from lib.errors import AppError
from lib.odds_sync import log_admin_action
from lib.supabase_client import SupabaseRestClient
from lib.users import first


def list_admin_users(db: SupabaseRestClient) -> list[dict[str, Any]]:
    users = db.select(
        "users",
        {
            "select": "*",
            "order": "created_at.desc",
            "limit": "100",
        },
    )
    if not users:
        return []
    users = [user for user in users if not is_deleted_user(user)]
    if not users:
        return []

    user_ids = [user["id"] for user in users]
    wallets = db.select(
        "wallets",
        {
            "select": "*",
            "user_id": f"in.({','.join(user_ids)})",
            "currency": "eq.DEMO",
        },
    )
    wallets_by_user = {wallet["user_id"]: wallet for wallet in wallets}

    return [{"user": user, "wallet": wallets_by_user.get(user["id"])} for user in users]


def create_admin_user(db: SupabaseRestClient, admin_user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    first_name = clean_text(payload.get("first_name"))
    last_name = clean_text(payload.get("last_name"))
    username = clean_text(payload.get("username")).lstrip("@")
    tg_id = clean_text(payload.get("tg_id")) or f"manual:{uuid4().hex}"
    balance = parse_balance(payload.get("balance", 0))

    if not first_name:
        raise AppError("invalid_first_name", "Введите имя пользователя", 400)

    user = first(
        db.insert(
            "users",
            {
                "tg_id": tg_id,
                "username": username or None,
                "first_name": first_name,
                "last_name": last_name,
                "client_status": "Новичок",
                "is_admin": False,
            },
        )
    )
    if not user:
        raise AppError("user_create_failed", "Не удалось создать пользователя", 500)

    wallet = first(db.insert("wallets", {"user_id": user["id"], "currency": "DEMO", "balance": balance}))
    if not wallet:
        raise AppError("wallet_create_failed", "Не удалось создать кошелек", 500)

    db.insert(
        "wallet_transactions",
        {
            "user_id": user["id"],
            "wallet_id": wallet["id"],
            "type": "admin_adjustment",
            "amount": balance,
            "balance_before": 0,
            "balance_after": balance,
            "metadata": {"reason": "admin_created_user"},
        },
    )
    log_admin_action(db, admin_user, "create_user", "user", user["id"], {"balance": balance})
    return {"user": user, "wallet": wallet}


def update_admin_user(
    db: SupabaseRestClient,
    admin_user: dict[str, Any],
    user_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    user = first(db.select("users", {"select": "*", "id": f"eq.{user_id}", "limit": "1"}))
    if not user:
        raise AppError("user_not_found", "Пользователь не найден", 404)

    user_patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("tg_id", "username", "first_name", "last_name"):
        if field not in payload:
            continue
        value = clean_text(payload.get(field))
        if field == "username":
            value = value.lstrip("@")
        if field in {"tg_id", "first_name"} and not value:
            raise AppError(f"invalid_{field}", "Telegram ID и имя не могут быть пустыми", 400)
        user_patch[field] = value or None

    if "is_blocked" in payload:
        user_patch["is_blocked"] = bool(payload.get("is_blocked"))

    updated_user = first(db.update("users", user_patch, {"id": f"eq.{user_id}"})) or {**user, **user_patch}

    wallet = first(
        db.select(
            "wallets",
            {
                "select": "*",
                "user_id": f"eq.{user_id}",
                "currency": "eq.DEMO",
                "limit": "1",
            },
        )
    )

    if "balance" in payload:
        new_balance = parse_balance(payload.get("balance"))
        if not wallet:
            wallet = first(db.insert("wallets", {"user_id": user_id, "currency": "DEMO", "balance": new_balance}))
            balance_before = 0
        else:
            balance_before = float(wallet["balance"])
            wallet = first(
                db.update(
                    "wallets",
                    {"balance": new_balance, "updated_at": datetime.now(timezone.utc).isoformat()},
                    {"id": f"eq.{wallet['id']}"},
                )
            )

        if wallet:
            db.insert(
                "wallet_transactions",
                {
                    "user_id": user_id,
                    "wallet_id": wallet["id"],
                    "type": "admin_adjustment",
                    "amount": round(new_balance - balance_before, 2),
                    "balance_before": balance_before,
                    "balance_after": new_balance,
                    "metadata": {"reason": "admin_user_edit"},
                },
            )

    log_admin_action(db, admin_user, "update_user", "user", user_id, payload)
    return {"user": updated_user, "wallet": wallet}


def delete_admin_user(db: SupabaseRestClient, admin_user: dict[str, Any], user_id: str) -> dict[str, Any]:
    user = first(db.select("users", {"select": "*", "id": f"eq.{user_id}", "limit": "1"}))
    if not user:
        raise AppError("user_not_found", "Пользователь не найден", 404)
    if admin_user.get("id") and user_id == admin_user.get("id"):
        raise AppError("delete_self_forbidden", "Нельзя удалить собственный админ-профиль", 400)

    try:
        cleanup_user_dependencies(db, user_id)
        deleted = db.delete("users", {"id": f"eq.{user_id}"})
        log_admin_action(db, admin_user, "delete_user", "user", user_id, {"tg_id": user.get("tg_id")})
        return {"deleted": True, "user": first(deleted) or user}
    except AppError as exc:
        if exc.error != "supabase_error":
            raise

    tombstone = f"deleted:{uuid4().hex}"
    patch = {
        "tg_id": tombstone,
        "username": None,
        "first_name": "Удаленный",
        "last_name": None,
        "client_status": "Новичок",
        "is_blocked": True,
        "block_reason": "deleted_by_admin",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    archived = first(db.update("users", patch, {"id": f"eq.{user_id}"})) or {**user, **patch}
    log_admin_action(
        db,
        admin_user,
        "archive_user_after_delete_failed",
        "user",
        user_id,
        {"tg_id": user.get("tg_id"), "reason": "foreign_key_reference"},
    )
    return {"deleted": True, "archived": True, "user": archived}


def cleanup_user_dependencies(db: SupabaseRestClient, user_id: str) -> None:
    bets = db.select("bets", {"select": "id", "user_id": f"eq.{user_id}", "limit": "1000"})
    bet_ids = [bet["id"] for bet in bets if bet.get("id")]
    if bet_ids:
        bet_filter = f"in.({','.join(bet_ids)})"
        db.update("wallet_transactions", {"related_bet_id": None}, {"related_bet_id": bet_filter}, return_rows=False)
        db.delete("bet_selections", {"bet_id": bet_filter})
        db.delete("bets", {"id": bet_filter})

    optional_delete(db, "fortune_wheel_spins", {"user_id": f"eq.{user_id}"})
    optional_delete(db, "user_league_rewards", {"user_id": f"eq.{user_id}"})
    db.delete("wallet_transactions", {"user_id": f"eq.{user_id}"})
    db.delete("wallets", {"user_id": f"eq.{user_id}"})


def optional_delete(db: SupabaseRestClient, table: str, params: dict[str, str]) -> None:
    try:
        db.delete(table, params)
    except AppError as exc:
        if exc.error != "supabase_error":
            raise


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def is_deleted_user(user: dict[str, Any]) -> bool:
    return str(user.get("tg_id") or "").startswith("deleted:")


def parse_balance(value: Any) -> float:
    try:
        balance = round(float(value), 2)
    except (TypeError, ValueError) as exc:
        raise AppError("invalid_balance", "Баланс должен быть числом", 400) from exc

    if balance < 0:
        raise AppError("invalid_balance", "Баланс не может быть отрицательным", 400)
    return balance
