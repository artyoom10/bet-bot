from flask import Request

from lib.config import admin_tg_ids
from lib.errors import AppError
from lib.supabase_client import SupabaseRestClient
from lib.telegram_auth import get_verified_telegram_user
from lib.users import first, upsert_user_from_tg


def require_admin(request: Request, db: SupabaseRestClient) -> dict:
    tg_user = get_verified_telegram_user(request)
    tg_id = str(tg_user["tg_id"])

    if tg_id in admin_tg_ids():
        return {
            "id": None,
            "tg_id": tg_id,
            "username": tg_user.get("username"),
            "first_name": tg_user.get("first_name"),
            "is_admin": True,
            "admin_source": "env",
        }

    existing = first(db.select("users", {"select": "*", "tg_id": f"eq.{tg_id}", "limit": "1"}))
    if not existing:
        raise AppError("forbidden", "Admin access required", 403)

    user = upsert_user_from_tg(db, tg_user)
    if user.get("is_admin"):
        return user

    raise AppError("forbidden", "Admin access required", 403)
