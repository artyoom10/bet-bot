from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lib.config import SPORT_KEYS
from lib.supabase_client import SupabaseRestClient


SELECTION_LABELS = {
    "home_win": "П1",
    "draw": "X",
    "away_win": "П2",
    "home_or_draw": "1X",
    "home_or_away": "12",
    "draw_or_away": "X2",
}

MARKET_TITLES = {
    "h2h": "Исход матча",
    "h2h_3_way": "Исход матча",
    "double_chance": "Двойной шанс",
    "totals": "Тотал",
    "alternate_totals": "Альтернативный тотал",
    "alternate_totals_h1": "Альтернативный тотал 1-го тайма",
    "alternate_totals_h2": "Альтернативный тотал 2-го тайма",
    "spreads": "Фора",
    "alternate_spreads": "Альтернативная фора",
    "alternate_spreads_h1": "Альтернативная фора 1-го тайма",
    "alternate_spreads_h2": "Альтернативная фора 2-го тайма",
    "video_review": "Видеопросмотр",
    "player_goal": "Гол игрока",
    "player_assist": "Передача игрока",
}

DEFAULT_SPORT_TITLES = {
    "soccer_epl": "Английская Премьер-лига",
    "soccer_russia_premier_league": "Российская Премьер-Лига",
    "soccer_spain_la_liga": "Ла Лига",
    "soccer_uefa_champs_league": "Лига чемпионов",
    "icehockey_nhl": "НХЛ",
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
    odds_rows = db.select("odds_current", {"select": "*", "event_id": f"in.({','.join(event_ids)})", "order": "bookmaker_key.asc,market_key.asc"})
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
        event_rows = [row for row in odds_by_event.get(event["id"], []) if not is_lay_market(row["market_key"])]
        event_odds = choose_market_odds(event_rows, "h2h") or choose_bookmaker_odds(event_rows)
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
                "league_logo_url": sports.get(event["sport_key"], {}).get("logo_url") or None,
                "home_team": format_team(home_team, event["home_team_raw"]),
                "away_team": format_team(away_team, event["away_team_raw"]),
                "commence_time": event["commence_time"],
                "odds": {
                    "bookmaker_key": bookmaker_key,
                    "bookmaker_title": bookmaker.get("title") or bookmaker_key,
                    "market_key": event_odds[0]["market_key"],
                    "title": market_title(event_odds[0]["market_key"], event["sport_key"]),
                    "outcomes": [format_outcome(row) for row in sort_outcomes(event_odds)],
                },
                "markets": format_markets(event_rows, bookmakers, event["sport_key"]),
            }
        )

    return formatted


def get_sports_for_app(db: SupabaseRestClient) -> list[dict[str, Any]]:
    sports = db.select("sports", {"select": "*", "is_enabled": "eq.true", "order": "sport_key.asc"})
    if not sports:
        sports = default_sports()
    else:
        existing_keys = {sport["sport_key"] for sport in sports}
        sports = [*sports, *(sport for sport in default_sports() if sport["sport_key"] not in existing_keys)]

    events = db.select(
        "events",
        {
            "select": "id,sport_key",
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
            "logo_url": sport.get("logo_url") or None,
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


def choose_market_odds(rows: list[dict[str, Any]], market_key: str) -> list[dict[str, Any]]:
    return choose_bookmaker_odds([row for row in rows if row["market_key"] == market_key])


def format_markets(rows: list[dict[str, Any]], bookmakers: dict[str, dict[str, Any]], sport_key: str | None = None) -> list[dict[str, Any]]:
    markets = []
    market_keys = []
    for row in rows:
        if is_lay_market(row["market_key"]):
            continue
        if row["market_key"] not in market_keys:
            market_keys.append(row["market_key"])

    market_order = {
        "h2h": 0,
        "h2h_3_way": 1,
        "double_chance": 2,
        "totals": 3,
        "alternate_totals": 4,
        "alternate_totals_h1": 5,
        "alternate_totals_h2": 6,
        "spreads": 7,
        "alternate_spreads": 8,
        "alternate_spreads_h1": 9,
        "alternate_spreads_h2": 10,
        "video_review": 11,
        "player_goal": 12,
        "player_assist": 13,
    }
    for market_key in sorted(market_keys, key=lambda key: market_order.get(key, 99)):
        market_rows = choose_market_odds(rows, market_key)
        if not market_rows:
            continue
        bookmaker_key = market_rows[0]["bookmaker_key"]
        bookmaker = bookmakers.get(bookmaker_key, {})
        markets.append(
            {
                "market_key": market_key,
                "title": market_title(market_key, sport_key),
                "bookmaker_key": bookmaker_key,
                "bookmaker_title": bookmaker.get("title") or bookmaker_key,
                "outcomes": [format_outcome(row) for row in sort_outcomes(market_rows)],
            }
        )
    return markets


def sort_outcomes(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    order = {
        "home_win": 0,
        "draw": 1,
        "away_win": 2,
        "home_or_draw": 3,
        "home_or_away": 4,
        "draw_or_away": 5,
    }

    def sort_key(row: dict[str, Any]) -> int:
        selection_key = row["selection_key"]
        if selection_key in order:
            return order[selection_key]
        if selection_key.startswith("total_over"):
            return 10
        if selection_key.startswith("total_under"):
            return 11
        if selection_key.startswith("handicap_home"):
            return 20
        if selection_key.startswith("handicap_away"):
            return 21
        if selection_key.endswith("_yes"):
            return 7
        if selection_key.endswith("_no"):
            return 8
        return 99

    return sorted(rows, key=sort_key)


def format_team(team: dict[str, Any] | None, raw_name: str) -> dict[str, Any]:
    return {
        "id": team.get("id") if team else None,
        "name": team.get("name_ru") if team else raw_name,
        "raw_name": raw_name,
        "logo_url": team.get("logo_url") if team else None,
    }


def format_outcome(row: dict[str, Any]) -> dict[str, Any]:
    name = row.get("selection_name_ru") or row["selection_name_raw"]
    return {
        "selection_key": row["selection_key"],
        "label": SELECTION_LABELS.get(row["selection_key"], name),
        "name": name,
        "price": float(row["price"]),
    }


def market_title(market_key: str, sport_key: str | None = None) -> str:
    if market_key == "h2h" and sport_key and sport_key.startswith("icehockey_"):
        return "Итоговая победа"
    return MARKET_TITLES.get(market_key, market_key)


def is_lay_market(market_key: str) -> bool:
    return market_key.endswith("_lay")
