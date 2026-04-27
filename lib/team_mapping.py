from __future__ import annotations

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
