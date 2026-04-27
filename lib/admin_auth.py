from flask import Request

from lib.config import admin_tg_ids
from lib.errors import AppError
from lib.supabase_client import SupabaseRestClient
from lib.telegram_auth import get_verified_telegram_user
from lib.users import upsert_user_from_tg


def require_admin(request: Request, db: SupabaseRestClient) -> dict:
    tg_user = get_verified_telegram_user(request)
    user = upsert_user_from_tg(db, tg_user)
    tg_id = str(user["tg_id"])

    if user.get("is_admin") or tg_id in admin_tg_ids():
        return user

    raise AppError("forbidden", "Admin access required", 403)
