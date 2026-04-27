from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from lib.config import SPORT_KEYS
from lib.errors import AppError
from lib.odds_api import fetch_odds_for_sport, refresh_usage as fetch_usage
from lib.supabase_client import SupabaseRestClient
from lib.team_mapping import find_team_by_raw_name, resolve_selection_name_ru
from lib.users import first


def run_odds_sync(
    db: SupabaseRestClient,
    *,
    triggered_by: str,
    admin_user: dict[str, Any] | None = None,
    sport_keys: list[str] | None = None,
) -> dict[str, Any]:
    started_after = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    active = first(
        db.select(
            "sync_runs",
            {
                "select": "*",
                "status": "eq.started",
                "started_at": f"gt.{started_after}",
                "limit": "1",
            },
        )
    )
    if active:
        raise AppError("sync_already_running", "Синхронизация уже запущена. Подождите несколько минут.", 409)

    sync_run = first(
        db.insert(
            "sync_runs",
            {
                "status": "started",
                "triggered_by": triggered_by,
                "triggered_by_user_id": admin_user.get("id") if admin_user else None,
            },
        )
    )
    if not sync_run:
        raise AppError("sync_run_create_failed", "Could not create sync run", 500)

    selected_sports = sport_keys or SPORT_KEYS
    totals = {
        "sports_count": len(selected_sports),
        "success_sports": 0,
        "failed_sports": 0,
        "events_count": 0,
        "odds_count": 0,
        "bookmakers_count": 0,
        "quota_last_total": 0,
        "quota_remaining": None,
        "quota_used": None,
        "errors": [],
        "started_at": sync_run["started_at"],
    }

    request_urls = []
    for sport_key in selected_sports:
        try:
            result = sync_single_sport(db, sport_key)
            totals["success_sports"] += 1
            totals["events_count"] += result["events_count"]
            totals["odds_count"] += result["odds_count"]
            totals["bookmakers_count"] += result["bookmakers_count"]
            totals["quota_last_total"] += result.get("quota_last") or 0
            totals["quota_remaining"] = result.get("quota_remaining")
            totals["quota_used"] = result.get("quota_used")
            request_urls.append(result.get("request_url"))
        except Exception as exc:
            totals["failed_sports"] += 1
            totals["errors"].append({"sport_key": sport_key, "message": str(exc)})

    status = "success"
    if totals["failed_sports"] and totals["success_sports"]:
        status = "partial_success"
    elif totals["failed_sports"] and not totals["success_sports"]:
        status = "error"

    finished_at = datetime.now(timezone.utc).isoformat()
    db.update(
        "sync_runs",
        {
            "status": status,
            "request_url": "\n".join([url for url in request_urls if url]),
            "events_count": totals["events_count"],
            "odds_count": totals["odds_count"],
            "bookmakers_count": totals["bookmakers_count"],
            "quota_remaining": totals["quota_remaining"],
            "quota_used": totals["quota_used"],
            "quota_last": totals["quota_last_total"],
            "error_message": "; ".join(error["message"] for error in totals["errors"])[:1000] or None,
            "finished_at": finished_at,
        },
        {"id": f"eq.{sync_run['id']}"},
    )

    if admin_user:
        log_admin_action(db, admin_user, "sync_odds", "sync_run", sync_run["id"], totals)

    totals["status"] = status
    totals["finished_at"] = finished_at
    return totals


def sync_single_sport(db: SupabaseRestClient, sport_key: str) -> dict[str, Any]:
    api_result = fetch_odds_for_sport(sport_key)
    events = api_result["data"]

    counts = {
        "events_count": 0,
        "odds_count": 0,
        "bookmakers_count": 0,
        "quota_remaining": api_result.get("quota_remaining"),
        "quota_used": api_result.get("quota_used"),
        "quota_last": api_result.get("quota_last"),
        "request_url": api_result.get("request_url"),
    }

    now = datetime.now(timezone.utc).isoformat()
    for source_event in events:
        home_raw = source_event["home_team"]
        away_raw = source_event["away_team"]
        home_team = find_team_by_raw_name(db, "odds_api", sport_key, home_raw)
        away_team = find_team_by_raw_name(db, "odds_api", sport_key, away_raw)

        event = first(
            db.upsert(
                "events",
                {
                    "source": "odds_api",
                    "external_event_id": source_event["id"],
                    "sport_key": sport_key,
                    "home_team_id": home_team.get("id") if home_team else None,
                    "away_team_id": away_team.get("id") if away_team else None,
                    "home_team_raw": home_raw,
                    "away_team_raw": away_raw,
                    "commence_time": source_event["commence_time"],
                    "status": "upcoming",
                    "raw_payload": source_event,
                    "last_odds_sync_at": now,
                    "updated_at": now,
                },
                "source,external_event_id",
            )
        )
        if not event:
            continue

        counts["events_count"] += 1
        for bookmaker in source_event.get("bookmakers", []):
            bookmaker_key = bookmaker["key"]
            db.upsert(
                "bookmakers",
                {"bookmaker_key": bookmaker_key, "title": bookmaker.get("title") or bookmaker_key, "updated_at": now},
                "bookmaker_key",
            )
            counts["bookmakers_count"] += 1

            for market in bookmaker.get("markets", []):
                if market.get("key") != "h2h":
                    continue
                for outcome in market.get("outcomes", []):
                    selection_key = selection_key_for_outcome(outcome["name"], home_raw, away_raw)
                    if not selection_key:
                        continue

                    old = first(
                        db.select(
                            "odds_current",
                            {
                                "select": "*",
                                "event_id": f"eq.{event['id']}",
                                "bookmaker_key": f"eq.{bookmaker_key}",
                                "market_key": "eq.h2h",
                                "selection_key": f"eq.{selection_key}",
                                "limit": "1",
                            },
                        )
                    )
                    selection_name_ru = resolve_selection_name_ru(selection_key, outcome["name"], home_team, away_team)
                    price = float(outcome["price"])
                    db.upsert(
                        "odds_current",
                        {
                            "event_id": event["id"],
                            "bookmaker_key": bookmaker_key,
                            "market_key": "h2h",
                            "selection_key": selection_key,
                            "selection_name_raw": outcome["name"],
                            "selection_name_ru": selection_name_ru,
                            "price": price,
                            "api_last_update": market.get("last_update") or bookmaker.get("last_update"),
                            "updated_at": now,
                        },
                        "event_id,bookmaker_key,market_key,selection_key",
                    )
                    counts["odds_count"] += 1

                    if not old or float(old["price"]) != price:
                        db.insert(
                            "odds_snapshots",
                            {
                                "event_id": event["id"],
                                "bookmaker_key": bookmaker_key,
                                "market_key": "h2h",
                                "selection_key": selection_key,
                                "selection_name_raw": outcome["name"],
                                "price": price,
                                "api_last_update": market.get("last_update") or bookmaker.get("last_update"),
                            },
                        )

    return counts


def refresh_odds_usage(db: SupabaseRestClient, admin_user: dict[str, Any]) -> dict[str, Any]:
    usage = fetch_usage()
    row = first(db.insert("odds_api_usage", usage))
    log_admin_action(db, admin_user, "refresh_odds_usage", "odds_api_usage", row.get("id") if row else None, usage)
    return row or usage


def selection_key_for_outcome(outcome_name: str, home_team_raw: str, away_team_raw: str) -> str | None:
    if outcome_name == home_team_raw:
        return "home_win"
    if outcome_name == "Draw":
        return "draw"
    if outcome_name == away_team_raw:
        return "away_win"
    return None


def log_admin_action(
    db: SupabaseRestClient,
    admin_user: dict[str, Any],
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    db.insert(
        "admin_logs",
        {
            "admin_user_id": admin_user.get("id"),
            "admin_tg_id": admin_user.get("tg_id"),
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "metadata": metadata or {},
        },
    )
