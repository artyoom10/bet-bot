from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from lib.errors import AppError
from lib.odds_sync import log_admin_action
from lib.supabase_client import SupabaseRestClient
from lib.users import first


def get_aliases_dashboard(db: SupabaseRestClient) -> dict[str, Any]:
    sports = db.select("sports", {"select": "*", "order": "sport_key.asc"})
    teams = db.select("teams", {"select": "*", "order": "name_en.asc", "limit": "300"})
    aliases = db.select("team_source_aliases", {"select": "*", "order": "raw_name.asc", "limit": "1000"})
    events = db.select(
        "events",
        {
            "select": "sport_key,home_team_id,away_team_id,home_team_raw,away_team_raw",
            "status": "eq.upcoming",
            "limit": "1000",
        },
    )

    aliases_by_team: dict[str, list[dict[str, Any]]] = {}
    known_keys = set()
    for alias in aliases:
        aliases_by_team.setdefault(alias["team_id"], []).append(alias)
        known_keys.add((alias.get("sport_key"), alias["raw_name"]))

    unknown = {}
    for event in events:
        for side in ("home", "away"):
            raw_name = event[f"{side}_team_raw"]
            team_id = event.get(f"{side}_team_id")
            key = (event["sport_key"], raw_name)
            if team_id or key in known_keys:
                continue
            unknown[key] = {"sport_key": event["sport_key"], "raw_name": raw_name}

    team_rows = []
    for team in teams:
        team_rows.append({"team": team, "aliases": aliases_by_team.get(team["id"], [])})

    return {
        "sports": sports,
        "unknown_teams": list(unknown.values()),
        "teams": team_rows,
    }


def update_sport_alias(db: SupabaseRestClient, admin_user: dict[str, Any], sport_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    title_ru = clean_text(payload.get("title_ru"))
    title_en = clean_text(payload.get("title_en"))
    patch = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if title_ru:
        patch["title_ru"] = title_ru
    if title_en:
        patch["title_en"] = title_en
    if len(patch) == 1:
        raise AppError("empty_payload", "Нет данных для обновления", 400)

    sport = first(db.update("sports", patch, {"sport_key": f"eq.{sport_key}"}))
    if not sport:
        raise AppError("sport_not_found", "Турнир не найден", 404)
    log_admin_action(db, admin_user, "update_sport_alias", "sport", sport_key, patch)
    return sport


def update_team_alias(db: SupabaseRestClient, admin_user: dict[str, Any], team_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    name_ru = clean_text(payload.get("name_ru"))
    short_name_ru = clean_text(payload.get("short_name_ru"))
    logo_url = clean_text(payload.get("logo_url"))
    patch = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if name_ru:
        patch["name_ru"] = name_ru
    if short_name_ru:
        patch["short_name_ru"] = short_name_ru
    if "logo_url" in payload:
        patch["logo_url"] = logo_url or None
    if len(patch) == 1:
        raise AppError("empty_payload", "Нет данных для обновления", 400)

    team = first(db.update("teams", patch, {"id": f"eq.{team_id}"}))
    if not team:
        raise AppError("team_not_found", "Команда не найдена", 404)
    log_admin_action(db, admin_user, "update_team_alias", "team", team_id, patch)
    return team


def create_team_alias(db: SupabaseRestClient, admin_user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    raw_name = clean_text(payload.get("raw_name"))
    sport_key = clean_text(payload.get("sport_key"))
    name_ru = clean_text(payload.get("name_ru"))
    short_name_ru = clean_text(payload.get("short_name_ru"))
    if not raw_name or not sport_key or not name_ru:
        raise AppError("invalid_alias", "Нужны raw_name, sport_key и русское название", 400)

    team = first(
        db.insert(
            "teams",
            {
                "name_en": raw_name,
                "name_ru": name_ru,
                "short_name_ru": short_name_ru or name_ru,
                "slug": f"{slugify(raw_name)}-{uuid4().hex[:8]}",
                "sport_type": "soccer",
            },
        )
    )
    if not team:
        raise AppError("team_create_failed", "Не удалось создать команду", 500)

    alias = first(
        db.upsert(
            "team_source_aliases",
            {
                "team_id": team["id"],
                "source": "odds_api",
                "sport_key": sport_key,
                "raw_name": raw_name,
            },
            "source,sport_key,raw_name",
        )
    )
    log_admin_action(db, admin_user, "create_team_alias", "team", team["id"], {"raw_name": raw_name, "sport_key": sport_key})
    return {"team": team, "alias": alias}


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def slugify(value: str) -> str:
    cleaned = "".join(char.lower() if char.isalnum() else "-" for char in value)
    return "-".join(part for part in cleaned.split("-") if part)[:80]
