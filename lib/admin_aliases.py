from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from lib.errors import AppError
from lib.odds_sync import log_admin_action
from lib.supabase_client import SupabaseRestClient
from lib.team_mapping import apply_all_aliases_for_team, apply_team_alias_to_existing_events
from lib.users import first


def get_aliases_dashboard(db: SupabaseRestClient) -> dict[str, Any]:
    sports = [
        sport
        for sport in db.select("sports", {"select": "*", "order": "sport_key.asc"})
        if sport.get("is_enabled")
        or (sport.get("source") != "manual" and not str(sport.get("sport_key") or "").startswith("manual_"))
    ]
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
    logo_url = clean_text(payload.get("logo_url"))
    patch = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if title_ru:
        patch["title_ru"] = title_ru
    if title_en:
        patch["title_en"] = title_en
    if "logo_url" in payload:
        patch["logo_url"] = logo_url or None
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
    sport_type = clean_sport_type(payload.get("sport_type"))
    patch = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if name_ru:
        patch["name_ru"] = name_ru
    if short_name_ru:
        patch["short_name_ru"] = short_name_ru
    if "logo_url" in payload:
        patch["logo_url"] = logo_url or None
    if sport_type:
        validate_team_sport_type_change(db, team_id, sport_type)
        patch["sport_type"] = sport_type
    if len(patch) == 1:
        raise AppError("empty_payload", "Нет данных для обновления", 400)

    team = first(db.update("teams", patch, {"id": f"eq.{team_id}"}))
    if not team:
        raise AppError("team_not_found", "Команда не найдена", 404)
    apply_all_aliases_for_team(db, team_id)
    log_admin_action(db, admin_user, "update_team_alias", "team", team_id, patch)
    return team


def create_team_alias(db: SupabaseRestClient, admin_user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    raw_name = clean_text(payload.get("raw_name"))
    sport_key = clean_text(payload.get("sport_key"))
    team_id = clean_text(payload.get("team_id"))
    name_ru = clean_text(payload.get("name_ru"))
    short_name_ru = clean_text(payload.get("short_name_ru"))
    logo_url = clean_text(payload.get("logo_url"))
    sport_type = sport_type_from_key(sport_key)
    if not raw_name or not sport_key:
        raise AppError("invalid_alias", "Нужны raw_name и sport_key", 400)

    if team_id:
        team = first(db.select("teams", {"select": "*", "id": f"eq.{team_id}", "limit": "1"}))
        if not team:
            raise AppError("team_not_found", "Команда не найдена", 404)
        if team.get("sport_type") and team.get("sport_type") != sport_type:
            raise AppError(
                "team_sport_mismatch",
                "Нельзя привязать команду другого вида спорта к этому турниру",
                400,
            )
        team_patch = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if name_ru:
            team_patch["name_ru"] = name_ru
        if short_name_ru:
            team_patch["short_name_ru"] = short_name_ru
        if "logo_url" in payload:
            team_patch["logo_url"] = logo_url or team.get("logo_url")
        if len(team_patch) > 1:
            team = first(db.update("teams", team_patch, {"id": f"eq.{team_id}"})) or team
    else:
        if not name_ru:
            raise AppError("invalid_alias", "Выберите существующую команду или введите русское название", 400)
        team = first(
            db.insert(
                "teams",
                {
                    "name_en": raw_name,
                    "name_ru": name_ru,
                    "short_name_ru": short_name_ru or name_ru,
                    "slug": f"{slugify(raw_name)}-{uuid4().hex[:8]}",
                    "logo_url": logo_url or None,
                    "sport_type": sport_type,
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
    apply_team_alias_to_existing_events(db, sport_key, raw_name, team["id"])
    log_admin_action(db, admin_user, "create_team_alias", "team", team["id"], {"raw_name": raw_name, "sport_key": sport_key})
    return {"team": team, "alias": alias}


def validate_team_sport_type_change(db: SupabaseRestClient, team_id: str, sport_type: str) -> None:
    aliases = db.select("team_source_aliases", {"select": "sport_key", "team_id": f"eq.{team_id}", "limit": "100"})
    mismatched = [
        alias.get("sport_key")
        for alias in aliases
        if alias.get("sport_key") and sport_type_from_key(alias["sport_key"]) != sport_type
    ]
    if mismatched:
        raise AppError(
            "team_sport_mismatch",
            "Нельзя сменить вид спорта: у команды уже есть алиасы в другом виде спорта",
            400,
        )


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def clean_sport_type(value: Any) -> str:
    sport_type = clean_text(value).lower()
    if not sport_type:
        return ""
    if sport_type not in {"soccer", "hockey", "esports"}:
        raise AppError("invalid_sport_type", "Выберите футбол, хоккей или киберспорт", 400)
    return sport_type


def sport_type_from_key(sport_key: str) -> str:
    if "hockey" in sport_key:
        return "hockey"
    if "esports" in sport_key:
        return "esports"
    return "soccer"


def slugify(value: str) -> str:
    cleaned = "".join(char.lower() if char.isalnum() else "-" for char in value)
    return "-".join(part for part in cleaned.split("-") if part)[:80]
