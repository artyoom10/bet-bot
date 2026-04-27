import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from flask import Request

from lib.config import env, env_bool
from lib.errors import AppError


def get_init_data_from_request(request: Request) -> str:
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if init_data:
        return init_data

    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("TMA "):
        return authorization[4:]

    return ""


def validate_telegram_init_data(init_data: str, bot_token: str) -> dict:
    if not init_data:
        raise AppError("missing_init_data", "Telegram initData is required", 401)

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise AppError("invalid_init_data", "Telegram initData hash is missing", 401)

    auth_date = int(pairs.get("auth_date", "0") or "0")
    max_age = int(env("TELEGRAM_INIT_DATA_MAX_AGE", "86400"))
    if max_age > 0 and (time.time() - auth_date) > max_age:
        raise AppError("expired_init_data", "Telegram initData is expired", 401)

    data_check_string = "\n".join(f"{key}={pairs[key]}" for key in sorted(pairs))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        raise AppError("invalid_init_data", "Telegram initData signature is invalid", 401)

    try:
        user = json.loads(pairs.get("user", "{}"))
    except json.JSONDecodeError as exc:
        raise AppError("invalid_init_data", "Telegram user payload is invalid", 401) from exc

    if not user.get("id"):
        raise AppError("invalid_init_data", "Telegram user id is missing", 401)

    user["tg_id"] = str(user["id"])
    return user


def get_verified_telegram_user(request: Request) -> dict:
    bot_token = env("TELEGRAM_BOT_TOKEN")
    init_data = get_init_data_from_request(request)

    if bot_token:
        return validate_telegram_init_data(init_data, bot_token)

    if env_bool("ALLOW_UNVERIFIED_TELEGRAM", False):
        return {
            "id": "0",
            "tg_id": "0",
            "username": "dev",
            "first_name": "Dev",
            "last_name": "",
            "language_code": "ru",
        }

    raise AppError("telegram_not_configured", "TELEGRAM_BOT_TOKEN is not configured", 500)
