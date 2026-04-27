from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lib.config import SPORT_KEYS
from lib.supabase_client import SupabaseRestClient


SELECTION_LABELS = {
    "home_win": "П1",
    "draw": "X",
    "away_win": "П2",
}

DEFAULT_SPORT_TITLES = {
    "soccer_russia_premier_league": "Российская Премьер-Лига",
    "soccer_spain_la_liga": "Ла Лига",
    "soccer_uefa_champs_league": "Лига чемпионов",
}


def get_events_for_app(db: SupabaseRestClient, sport_key: str | None = None) -> list[dict[str, Any]]:
    params = {
        "select": "*",
        "status": "eq.upcoming",
        "commence_time": f"gt.{datetime.now(timezone.utc).isoformat()}",
        "order": "commence_time.asc",
        "limit": "100",
    }
    if sport_key:
        params["sport_key"] = f"eq.{sport_key}"

    events = db.select("events", params)
    if not events:
        return []

    sport_keys = sorted({event["sport_key"] for event in events})
    sports = {
        row["sport_key"]: row
        for row in db.select("sports", {"select": "*", "sport_key": f"in.({','.join(sport_keys)})"})
    }

    team_ids = sorted(
        {
            team_id
            for event in events
            for team_id in (event.get("home_team_id"), event.get("away_team_id"))
            if team_id
        }
    )
    teams = {}
    if team_ids:
        teams = {
            row["id"]: row
            for row in db.select("teams", {"select": "*", "id": f"in.({','.join(team_ids)})"})
        }

    event_ids = [event["id"] for event in events]
    odds_rows = db.select(
        "odds_current",
        {
            "select": "*",
            "event_id": f"in.({','.join(event_ids)})",
            "market_key": "eq.h2h",
            "order": "bookmaker_key.asc",
        },
    )
    odds_by_event: dict[str, list[dict[str, Any]]] = {}
    bookmaker_keys = set()
    for row in odds_rows:
        odds_by_event.setdefault(row["event_id"], []).append(row)
        bookmaker_keys.add(row["bookmaker_key"])

    bookmakers = {}
    if bookmaker_keys:
        bookmakers = {
            row["bookmaker_key"]: row
            for row in db.select("bookmakers", {"select": "*", "bookmaker_key": f"in.({','.join(sorted(bookmaker_keys))})"})
        }

    formatted = []
    for event in events:
        event_odds = choose_bookmaker_odds(odds_by_event.get(event["id"], []))
        if not event_odds:
            continue

        home_team = teams.get(event.get("home_team_id"))
        away_team = teams.get(event.get("away_team_id"))
        bookmaker_key = event_odds[0]["bookmaker_key"]
        bookmaker = bookmakers.get(bookmaker_key, {})

        formatted.append(
            {
                "id": event["id"],
                "sport_key": event["sport_key"],
                "league_title": sports.get(event["sport_key"], {}).get("title_ru") or sports.get(event["sport_key"], {}).get("title_en") or event["sport_key"],
                "home_team": format_team(home_team, event["home_team_raw"]),
                "away_team": format_team(away_team, event["away_team_raw"]),
                "commence_time": event["commence_time"],
                "odds": {
                    "bookmaker_key": bookmaker_key,
                    "bookmaker_title": bookmaker.get("title") or bookmaker_key,
                    "market_key": "h2h",
                    "outcomes": [format_outcome(row) for row in sort_outcomes(event_odds)],
                },
            }
        )

    return formatted


def get_sports_for_app(db: SupabaseRestClient) -> list[dict[str, Any]]:
    sports = db.select("sports", {"select": "*", "is_enabled": "eq.true", "order": "sport_key.asc"})
    if not sports:
        sports = default_sports()

    events = db.select(
        "events",
        {
            "select": "sport_key",
            "status": "eq.upcoming",
            "commence_time": f"gt.{datetime.now(timezone.utc).isoformat()}",
            "limit": "1000",
        },
    )
    counts = {}
    for event in events:
        counts[event["sport_key"]] = counts.get(event["sport_key"], 0) + 1

    return [
        {
            "sport_key": sport["sport_key"],
            "title": sport.get("title_ru") or sport.get("title_en") or sport["sport_key"],
            "events_count": counts.get(sport["sport_key"], 0),
        }
        for sport in sports
    ]


def default_sports() -> list[dict[str, Any]]:
    return [
        {
            "sport_key": sport_key,
            "title_ru": DEFAULT_SPORT_TITLES.get(sport_key, sport_key),
            "title_en": sport_key,
        }
        for sport_key in SPORT_KEYS
    ]


def choose_bookmaker_odds(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []

    preferred = [row for row in rows if row["bookmaker_key"] == "pinnacle"]
    selected_key = "pinnacle" if preferred else rows[0]["bookmaker_key"]
    return [row for row in rows if row["bookmaker_key"] == selected_key]


def sort_outcomes(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    order = {"home_win": 0, "draw": 1, "away_win": 2}
    return sorted(rows, key=lambda row: order.get(row["selection_key"], 99))


def format_team(team: dict[str, Any] | None, raw_name: str) -> dict[str, Any]:
    return {
        "id": team.get("id") if team else None,
        "name": team.get("name_ru") if team else raw_name,
        "raw_name": raw_name,
        "logo_url": team.get("logo_url") if team else None,
    }


def format_outcome(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "selection_key": row["selection_key"],
        "label": SELECTION_LABELS.get(row["selection_key"], row["selection_key"]),
        "name": row.get("selection_name_ru") or row["selection_name_raw"],
        "price": float(row["price"]),
    }
