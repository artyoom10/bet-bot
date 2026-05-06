from __future__ import annotations

from typing import Any

import requests

from lib.config import env
from lib.errors import AppError


BASE_URL = "https://api.the-odds-api.com/v4"
ODDS_MARKETS = ("h2h", "spreads", "totals")


def odds_regions(sport_key: str | None = None) -> str:
    if sport_key and sport_key.startswith("icehockey_"):
        return env("ODDS_API_HOCKEY_REGIONS", "us,eu")
    return env("ODDS_API_REGIONS", "eu")


def masked_url(response: requests.Response, api_key: str) -> str:
    return response.url.replace(api_key, "***")


def fetch_odds_for_sport(sport_key: str) -> dict[str, Any]:
    api_key = env("ODDS_API_KEY")
    if not api_key:
        raise AppError("odds_api_not_configured", "ODDS_API_KEY is not configured", 500)

    params = {
        "apiKey": api_key,
        "regions": odds_regions(sport_key),
        "markets": ",".join(ODDS_MARKETS),
        "oddsFormat": "decimal",
        "dateFormat": "iso",
    }
    response = requests.get(f"{BASE_URL}/sports/{sport_key}/odds", params=params, timeout=20)
    if response.status_code >= 400:
        raise AppError("odds_api_error", f"Odds API returned {response.status_code}: {response.text[:300]}", 502)

    return {
        "data": response.json(),
        "quota_remaining": header_int(response, "x-requests-remaining"),
        "quota_used": header_int(response, "x-requests-used"),
        "quota_last": header_int(response, "x-requests-last"),
        "request_url": masked_url(response, api_key),
        "regions": params["regions"],
        "markets": params["markets"],
    }


def fetch_events_for_sport(sport_key: str) -> dict[str, Any]:
    api_key = env("ODDS_API_KEY")
    if not api_key:
        raise AppError("odds_api_not_configured", "ODDS_API_KEY is not configured", 500)

    params = {
        "apiKey": api_key,
        "dateFormat": "iso",
    }
    response = requests.get(f"{BASE_URL}/sports/{sport_key}/events", params=params, timeout=20)
    if response.status_code >= 400:
        raise AppError("odds_api_error", f"Odds API events returned {response.status_code}: {response.text[:300]}", 502)

    return {
        "data": response.json(),
        "quota_remaining": header_int(response, "x-requests-remaining"),
        "quota_used": header_int(response, "x-requests-used"),
        "quota_last": header_int(response, "x-requests-last"),
        "request_url": masked_url(response, api_key),
    }


def fetch_event_markets(sport_key: str, event_id: str) -> dict[str, Any]:
    api_key = env("ODDS_API_KEY")
    if not api_key:
        raise AppError("odds_api_not_configured", "ODDS_API_KEY is not configured", 500)

    params = {
        "apiKey": api_key,
        "regions": odds_regions(sport_key),
        "dateFormat": "iso",
    }
    response = requests.get(f"{BASE_URL}/sports/{sport_key}/events/{event_id}/markets", params=params, timeout=20)
    if response.status_code >= 400:
        raise AppError("odds_api_error", f"Odds API event markets returned {response.status_code}: {response.text[:300]}", 502)

    return {
        "data": response.json(),
        "quota_remaining": header_int(response, "x-requests-remaining"),
        "quota_used": header_int(response, "x-requests-used"),
        "quota_last": header_int(response, "x-requests-last"),
        "request_url": masked_url(response, api_key),
        "regions": params["regions"],
    }


def fetch_event_odds(sport_key: str, event_id: str, markets: list[str]) -> dict[str, Any]:
    api_key = env("ODDS_API_KEY")
    if not api_key:
        raise AppError("odds_api_not_configured", "ODDS_API_KEY is not configured", 500)
    if not markets:
        raise AppError("event_markets_empty", "No markets to request for event", 400)

    params = {
        "apiKey": api_key,
        "regions": odds_regions(sport_key),
        "markets": ",".join(markets),
        "oddsFormat": "decimal",
        "dateFormat": "iso",
    }
    response = requests.get(f"{BASE_URL}/sports/{sport_key}/events/{event_id}/odds", params=params, timeout=30)
    if response.status_code >= 400:
        raise AppError("odds_api_error", f"Odds API event odds returned {response.status_code}: {response.text[:300]}", 502)

    return {
        "data": response.json(),
        "quota_remaining": header_int(response, "x-requests-remaining"),
        "quota_used": header_int(response, "x-requests-used"),
        "quota_last": header_int(response, "x-requests-last"),
        "request_url": masked_url(response, api_key),
        "regions": params["regions"],
        "markets": params["markets"],
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


def fetch_scores_for_sport(
    sport_key: str,
    days_from: int = 3,
    event_ids: list[str] | None = None,
) -> dict[str, Any]:
    api_key = env("ODDS_API_KEY")
    if not api_key:
        raise AppError("odds_api_not_configured", "ODDS_API_KEY is not configured", 500)

    params: dict[str, Any] = {
        "apiKey": api_key,
        "dateFormat": "iso",
    }
    if days_from:
        params["daysFrom"] = min(max(int(days_from), 1), 3)
    if event_ids:
        params["eventIds"] = ",".join(event_ids)

    response = requests.get(f"{BASE_URL}/sports/{sport_key}/scores", params=params, timeout=30)
    if response.status_code >= 400:
        raise AppError("odds_api_error", f"Odds API scores returned {response.status_code}: {response.text[:300]}", 502)

    return {
        "data": response.json(),
        "quota_remaining": header_int(response, "x-requests-remaining"),
        "quota_used": header_int(response, "x-requests-used"),
        "quota_last": header_int(response, "x-requests-last"),
        "request_url": masked_url(response, api_key),
    }


def header_int(response: requests.Response, name: str) -> int | None:
    value = response.headers.get(name)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None
