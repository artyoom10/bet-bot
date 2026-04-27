from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from lib.errors import AppError
from lib.odds_sync import log_admin_action
from lib.supabase_client import SupabaseRestClient
from lib.users import first


CLIENT_STATUSES = {"new", "active", "vip", "test", "restricted", "suspended"}


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
    balance = parse_balance(payload.get("balance", 0))

    if not first_name:
        raise AppError("invalid_first_name", "Введите имя пользователя", 400)

    user = first(
        db.insert(
            "users",
            {
                "tg_id": f"manual:{uuid4().hex}",
                "first_name": first_name,
                "last_name": last_name,
                "client_status": "active",
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
    if "client_status" in payload:
        status = clean_text(payload.get("client_status"))
        if status not in CLIENT_STATUSES:
            raise AppError("invalid_status", "Некорректный статус пользователя", 400)
        user_patch["client_status"] = status

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


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def parse_balance(value: Any) -> float:
    try:
        balance = round(float(value), 2)
    except (TypeError, ValueError) as exc:
        raise AppError("invalid_balance", "Баланс должен быть числом", 400) from exc

    if balance < 0:
        raise AppError("invalid_balance", "Баланс не может быть отрицательным", 400)
    return balance
