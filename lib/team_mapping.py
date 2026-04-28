from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lib.supabase_client import SupabaseRestClient
from lib.users import first


def find_team_by_raw_name(db: SupabaseRestClient, source: str, sport_key: str, raw_name: str) -> dict[str, Any] | None:
    alias = first(
        db.select(
            "team_source_aliases",
            {
                "select": "*",
                "source": f"eq.{source}",
                "sport_key": f"eq.{sport_key}",
                "raw_name": f"eq.{raw_name}",
                "limit": "1",
            },
        )
    )
    if not alias:
        return None

    return first(db.select("teams", {"select": "*", "id": f"eq.{alias['team_id']}", "limit": "1"}))


def resolve_selection_name_ru(
    selection_key: str,
    selection_name_raw: str,
    home_team: dict[str, Any] | None,
    away_team: dict[str, Any] | None,
) -> str:
    if selection_key == "home_win":
        return (home_team or {}).get("name_ru") or selection_name_raw
    if selection_key == "away_win":
        return (away_team or {}).get("name_ru") or selection_name_raw
    if selection_key == "draw":
        return "Ничья"
    return selection_name_raw


def apply_team_alias_to_existing_events(
    db: SupabaseRestClient,
    sport_key: str,
    raw_name: str,
    team_id: str,
) -> dict[str, int]:
    team = first(db.select("teams", {"select": "*", "id": f"eq.{team_id}", "limit": "1"}))
    if not team:
        return {"events_updated": 0, "odds_updated": 0}

    now = datetime.now(timezone.utc).isoformat()
    home_events = db.select(
        "events",
        {
            "select": "id",
            "sport_key": f"eq.{sport_key}",
            "home_team_raw": f"eq.{raw_name}",
            "limit": "1000",
        },
    )
    away_events = db.select(
        "events",
        {
            "select": "id",
            "sport_key": f"eq.{sport_key}",
            "away_team_raw": f"eq.{raw_name}",
            "limit": "1000",
        },
    )

    odds_updated = 0
    for event in home_events:
        db.update("events", {"home_team_id": team_id, "updated_at": now}, {"id": f"eq.{event['id']}"})
        db.update("odds_current", {"selection_name_ru": team["name_ru"], "updated_at": now}, {"event_id": f"eq.{event['id']}", "selection_key": "eq.home_win"})
        db.update("odds_current", {"selection_name_ru": "Ничья", "updated_at": now}, {"event_id": f"eq.{event['id']}", "selection_key": "eq.draw"})
        odds_updated += 2

    for event in away_events:
        db.update("events", {"away_team_id": team_id, "updated_at": now}, {"id": f"eq.{event['id']}"})
        db.update("odds_current", {"selection_name_ru": team["name_ru"], "updated_at": now}, {"event_id": f"eq.{event['id']}", "selection_key": "eq.away_win"})
        db.update("odds_current", {"selection_name_ru": "Ничья", "updated_at": now}, {"event_id": f"eq.{event['id']}", "selection_key": "eq.draw"})
        odds_updated += 2

    return {"events_updated": len(home_events) + len(away_events), "odds_updated": odds_updated}


def apply_all_aliases_for_team(db: SupabaseRestClient, team_id: str) -> dict[str, int]:
    aliases = db.select("team_source_aliases", {"select": "*", "team_id": f"eq.{team_id}", "limit": "1000"})
    totals = {"events_updated": 0, "odds_updated": 0}
    for alias in aliases:
        result = apply_team_alias_to_existing_events(db, alias["sport_key"], alias["raw_name"], team_id)
        totals["events_updated"] += result["events_updated"]
        totals["odds_updated"] += result["odds_updated"]
    return totals
