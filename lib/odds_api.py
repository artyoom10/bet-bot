from __future__ import annotations

from typing import Any

import requests

from lib.config import env
from lib.errors import AppError


BASE_URL = "https://api.the-odds-api.com/v4"


def fetch_odds_for_sport(sport_key: str) -> dict[str, Any]:
    api_key = env("ODDS_API_KEY")
    if not api_key:
        raise AppError("odds_api_not_configured", "ODDS_API_KEY is not configured", 500)

    params = {
        "apiKey": api_key,
        "regions": "eu",
        "markets": "h2h",
        "oddsFormat": "decimal",
        "dateFormat": "iso",
    }
    response = requests.get(f"{BASE_URL}/sports/{sport_key}/odds", params=params, timeout=30)
    if response.status_code >= 400:
        raise AppError("odds_api_error", f"Odds API returned {response.status_code}: {response.text[:300]}", 502)

    return {
        "data": response.json(),
        "quota_remaining": header_int(response, "x-requests-remaining"),
        "quota_used": header_int(response, "x-requests-used"),
        "quota_last": header_int(response, "x-requests-last"),
        "request_url": response.url.replace(api_key, "***"),
    }


def refresh_usage() -> dict[str, Any]:
    api_key = env("ODDS_API_KEY")
    if not api_key:
        raise AppError("odds_api_not_configured", "ODDS_API_KEY is not configured", 500)

    response = requests.get(f"{BASE_URL}/sports/", params={"apiKey": api_key, "all": "true"}, timeout=30)
    if response.status_code >= 400:
        raise AppError("odds_api_error", f"Odds API returned {response.status_code}: {response.text[:300]}", 502)

    return {
        "quota_remaining": header_int(response, "x-requests-remaining"),
        "quota_used": header_int(response, "x-requests-used"),
        "quota_last": header_int(response, "x-requests-last"),
        "fetched_from": "sports",
    }


def header_int(response: requests.Response, name: str) -> int | None:
    value = response.headers.get(name)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None
