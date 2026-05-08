from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lib.config import admin_tg_ids
from lib.errors import AppError
from lib.supabase_client import SupabaseRestClient


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def first(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    return rows[0] if rows else None


def upsert_user_from_tg(db: SupabaseRestClient, tg_user: dict[str, Any]) -> dict[str, Any]:
    tg_id = str(tg_user["tg_id"])
    existing = first(db.select("users", {"select": "*", "tg_id": f"eq.{tg_id}", "limit": "1"}))
    is_env_admin = tg_id in admin_tg_ids()

    payload = {
        "tg_id": tg_id,
        "username": tg_user.get("username"),
        "first_name": tg_user.get("first_name"),
        "last_name": tg_user.get("last_name"),
        "language_code": tg_user.get("language_code"),
        "client_status": "Новичок",
        "last_seen_at": utc_now(),
        "updated_at": utc_now(),
    }

    if existing:
        payload["username"] = existing.get("username") or tg_user.get("username")
        payload["first_name"] = existing.get("first_name") or tg_user.get("first_name")
        payload["last_name"] = existing.get("last_name") or tg_user.get("last_name")
        payload["client_status"] = existing.get("client_status") or "Новичок"
        if is_env_admin and not existing.get("is_admin"):
            payload["is_admin"] = True
        updated = db.update("users", payload, {"id": f"eq.{existing['id']}"})
        return first(updated) or {**existing, **payload}

    payload["is_admin"] = is_env_admin
    created = db.insert("users", payload)
    user = first(created)
    if not user:
        raise AppError("user_create_failed", "Could not create user", 500)

    return user


def get_or_create_wallet(db: SupabaseRestClient, user: dict[str, Any]) -> dict[str, Any]:
    wallet = first(
        db.select(
            "wallets",
            {
                "select": "*",
                "user_id": f"eq.{user['id']}",
                "currency": "eq.DEMO",
                "limit": "1",
            },
        )
    )
    if wallet:
        return wallet

    wallet = first(db.insert("wallets", {"user_id": user["id"], "currency": "DEMO", "balance": 1000}))
    if not wallet:
        raise AppError("wallet_create_failed", "Could not create wallet", 500)

    db.insert(
        "wallet_transactions",
        {
            "user_id": user["id"],
            "wallet_id": wallet["id"],
            "type": "demo_bonus",
            "amount": 1000,
            "balance_before": 0,
            "balance_after": wallet["balance"],
            "metadata": {"reason": "initial_demo_balance"},
        },
    )
    return wallet


def ensure_active_user(user: dict[str, Any]) -> None:
    if user.get("is_blocked"):
        raise AppError("user_blocked", user.get("block_reason") or "User is blocked", 403)
