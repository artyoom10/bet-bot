from __future__ import annotations

from datetime import datetime, timedelta, timezone
from traceback import format_exception
from typing import Any

from lib.config import SPORT_KEYS, env
from lib.errors import AppError
from lib.odds_api import fetch_event_markets, fetch_event_odds, fetch_events_for_sport, fetch_odds_for_sport, refresh_usage as fetch_usage
from lib.supabase_client import SupabaseRestClient
from lib.team_mapping import find_team_by_raw_name, resolve_selection_name_ru
from lib.users import first


SYNC_STALE_AFTER_MINUTES = 3
DEFAULT_SYNC_BOOKMAKER_KEYS = ("pinnacle", "onexbet", "marathonbet")


SPORT_TITLES = {
    "soccer_epl": {
        "title_en": "EPL",
        "title_ru": "Английская Премьер-лига",
        "group_name": "Soccer",
    },
    "soccer_russia_premier_league": {
        "title_en": "Premier League - Russia",
        "title_ru": "Российская Премьер-Лига",
        "group_name": "Soccer",
    },
    "soccer_spain_la_liga": {
        "title_en": "La Liga - Spain",
        "title_ru": "Ла Лига",
        "group_name": "Soccer",
    },
    "soccer_uefa_champs_league": {
        "title_en": "UEFA Champions League",
        "title_ru": "Лига чемпионов",
        "group_name": "Soccer",
    },
    "icehockey_nhl": {
        "title_en": "NHL",
        "title_ru": "НХЛ",
        "group_name": "Ice Hockey",
    },
}


def sync_bookmaker_keys() -> list[str]:
    raw = env("ODDS_SYNC_BOOKMAKER_KEYS", ",".join(DEFAULT_SYNC_BOOKMAKER_KEYS))
    if raw.lower() == "all":
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def filter_bookmakers(bookmakers: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    keys = sync_bookmaker_keys()
    if not keys:
        return bookmakers, "all"

    selected = [bookmaker for bookmaker in bookmakers if bookmaker.get("key") in keys]
    if selected:
        return selected, ",".join(keys)

    fallback_count = min(3, len(bookmakers))
    return bookmakers[:fallback_count], f"fallback_first_{fallback_count}"


def unique_rows(rows: list[dict[str, Any]], key_fields: tuple[str, ...]) -> list[dict[str, Any]]:
    result: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in rows:
        result[tuple(row.get(field) for field in key_fields)] = row
    return list(result.values())


def run_odds_sync(
    db: SupabaseRestClient,
    *,
    triggered_by: str,
    admin_user: dict[str, Any] | None = None,
    sport_keys: list[str] | None = None,
) -> dict[str, Any]:
    mark_stale_syncs(db)
    started_after = (datetime.now(timezone.utc) - timedelta(minutes=SYNC_STALE_AFTER_MINUTES)).isoformat()
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

    selected_sports = sport_keys or SPORT_KEYS
    sync_run = first(
        db.insert(
            "sync_runs",
            {
                "status": "started",
                "sport_key": selected_sports[0] if len(selected_sports) == 1 else None,
                "triggered_by": triggered_by,
                "triggered_by_user_id": admin_user.get("id") if admin_user else None,
            },
        )
    )
    if not sync_run:
        raise AppError("sync_run_create_failed", "Could not create sync run", 500)

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
        "selected_sports": selected_sports,
        "sport_results": [],
        "debug_steps": [{"step": "sync_run_created", "sync_run_id": sync_run["id"], "at": sync_run["started_at"]}],
        "started_at": sync_run["started_at"],
    }

    request_urls = []
    status = "success"
    try:
        ensure_sports_seed(db, selected_sports)
        totals["debug_steps"].append({"step": "sports_seed_done", "at": datetime.now(timezone.utc).isoformat()})
        for sport_key in selected_sports:
            sport_started_at = datetime.now(timezone.utc)
            sport_report = {"sport_key": sport_key, "status": "started", "started_at": sport_started_at.isoformat()}
            try:
                result = sync_single_sport(db, sport_key)
                totals["success_sports"] += 1
                totals["events_count"] += result["events_count"]
                totals["odds_count"] += result["odds_count"]
                totals["bookmakers_count"] += result["bookmakers_count"]
                totals["quota_last_total"] += result.get("quota_last") or 0
                totals["quota_remaining"] = result.get("quota_remaining")
                totals["quota_used"] = result.get("quota_used")
                request_urls.append(result.get("events_request_url"))
                request_urls.append(result.get("request_url"))
                sport_report.update(
                    {
                        "status": "success",
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                        "duration_seconds": round((datetime.now(timezone.utc) - sport_started_at).total_seconds(), 3),
                        **result,
                    }
                )
            except Exception as exc:
                totals["failed_sports"] += 1
                error = exception_debug(exc)
                error["sport_key"] = sport_key
                totals["errors"].append(error)
                sport_report.update(
                    {
                        "status": "error",
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                        "duration_seconds": round((datetime.now(timezone.utc) - sport_started_at).total_seconds(), 3),
                        "error": error,
                    }
                )
            totals["sport_results"].append(sport_report)

        if totals["failed_sports"] and totals["success_sports"]:
            status = "partial_success"
        elif totals["failed_sports"] and not totals["success_sports"]:
            status = "error"
    except Exception as exc:
        status = "error"
        totals["errors"].append(exception_debug(exc))
    finally:
        finished_at = datetime.now(timezone.utc).isoformat()
        try:
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
            totals["debug_steps"].append({"step": "sync_run_updated", "at": finished_at})
        except Exception as exc:
            status = "error"
            totals["errors"].append({"stage": "sync_run_update", **exception_debug(exc)})

    latest = first(db.select("sync_runs", {"select": "*", "id": f"eq.{sync_run['id']}", "limit": "1"}))
    if admin_user:
        log_admin_action(db, admin_user, "sync_odds", "sync_run", sync_run["id"], totals)

    totals["status"] = status
    totals["finished_at"] = latest.get("finished_at") if latest else finished_at
    totals["run"] = latest
    return totals


def sync_single_sport(db: SupabaseRestClient, sport_key: str) -> dict[str, Any]:
    events_api_result: dict[str, Any] | None = None
    events_api_error: dict[str, Any] | None = None
    try:
        events_api_result = fetch_events_for_sport(sport_key)
    except Exception as exc:
        events_api_error = exception_debug(exc)

    api_result = fetch_odds_for_sport(sport_key)
    events = api_result["data"]
    plain_events = events_api_result["data"] if events_api_result else []

    counts = {
        "events_endpoint_count": len(plain_events),
        "odds_endpoint_events_count": len(events),
        "api_events_count": len(events),
        "events_count": 0,
        "odds_count": 0,
        "bookmakers_count": 0,
        "snapshots_count": 0,
        "snapshots_note": "disabled_for_fast_sync",
        "source_bookmakers_count": 0,
        "processed_bookmakers_count": 0,
        "skipped_bookmakers_count": 0,
        "bookmaker_filter": ",".join(sync_bookmaker_keys()) or "all",
        "events_without_h2h": 0,
        "events_without_odds": 0,
        "markets_requested": ["h2h", "spreads", "totals"],
        "regions_requested": api_result.get("regions"),
        "double_chance_derived_count": 0,
        "quota_remaining": api_result.get("quota_remaining"),
        "quota_used": api_result.get("quota_used"),
        "quota_last": api_result.get("quota_last"),
        "events_quota_remaining": events_api_result.get("quota_remaining") if events_api_result else None,
        "events_quota_used": events_api_result.get("quota_used") if events_api_result else None,
        "events_quota_last": events_api_result.get("quota_last") if events_api_result else None,
        "request_url": api_result.get("request_url"),
        "events_request_url": events_api_result.get("request_url") if events_api_result else None,
        "events_endpoint_error": events_api_error,
        "events_without_odds_samples": [],
    }

    saved_event_external_ids = set()
    now = datetime.now(timezone.utc).isoformat()
    odds_event_ids = {source_event.get("id") for source_event in events}
    for source_event in plain_events:
        event = upsert_api_event(db, sport_key, source_event, now)
        if not event:
            continue
        saved_event_external_ids.add(source_event.get("id"))
        counts["events_count"] += 1
        if source_event.get("id") not in odds_event_ids:
            counts["events_without_odds"] += 1
            if len(counts["events_without_odds_samples"]) < 8:
                counts["events_without_odds_samples"].append(
                    {
                        "id": source_event.get("id"),
                        "commence_time": source_event.get("commence_time"),
                        "home_team": source_event.get("home_team"),
                        "away_team": source_event.get("away_team"),
                    }
                )

    for source_event in events:
        home_raw = source_event["home_team"]
        away_raw = source_event["away_team"]
        home_team = find_team_by_raw_name(db, "odds_api", sport_key, home_raw)
        away_team = find_team_by_raw_name(db, "odds_api", sport_key, away_raw)

        event = upsert_api_event(db, sport_key, source_event, now, home_team=home_team, away_team=away_team)
        if not event:
            continue

        if source_event.get("id") not in saved_event_external_ids:
            counts["events_count"] += 1
            saved_event_external_ids.add(source_event.get("id"))
        event_h2h_count = 0
        source_bookmakers = source_event.get("bookmakers", [])
        bookmakers, filter_label = filter_bookmakers(source_bookmakers)
        counts["source_bookmakers_count"] += len(source_bookmakers)
        counts["processed_bookmakers_count"] += len(bookmakers)
        counts["skipped_bookmakers_count"] += max(0, len(source_bookmakers) - len(bookmakers))
        counts["bookmaker_filter"] = filter_label

        bookmaker_rows: list[dict[str, Any]] = []
        odds_rows: list[dict[str, Any]] = []
        for bookmaker in bookmakers:
            bookmaker_key = bookmaker["key"]
            bookmaker_rows.append(
                {"bookmaker_key": bookmaker_key, "title": bookmaker.get("title") or bookmaker_key, "updated_at": now}
            )
            counts["bookmakers_count"] += 1

            market_keys_seen = set()
            h2h_prices: dict[str, float] = {}
            h2h_names: dict[str, str] = {}
            for market in bookmaker.get("markets", []):
                market_key = market.get("key")
                market_keys_seen.add(market_key)
                for outcome in market.get("outcomes", []):
                    odd_payload = odd_payload_for_outcome(
                        event["id"],
                        bookmaker_key,
                        market_key,
                        outcome,
                        home_raw,
                        away_raw,
                        home_team,
                        away_team,
                        now,
                    )
                    if not odd_payload:
                        continue

                    odd_payload["api_last_update"] = market.get("last_update") or bookmaker.get("last_update")
                    odds_rows.append(odd_payload)
                    counts["odds_count"] += 1
                    if odd_payload["market_key"] == "h2h":
                        event_h2h_count += 1
                        h2h_prices[odd_payload["selection_key"]] = float(odd_payload["price"])
                        h2h_names[odd_payload["selection_key"]] = odd_payload["selection_name_ru"]

            if sport_key.startswith("soccer_") and "double_chance" not in market_keys_seen:
                derived_rows = derived_double_chance_rows(event["id"], bookmaker_key, h2h_prices, h2h_names, now)
                for row in derived_rows:
                    odds_rows.append(row)
                    counts["odds_count"] += 1
                    counts["double_chance_derived_count"] += 1

        if bookmaker_rows:
            db.upsert(
                "bookmakers",
                unique_rows(bookmaker_rows, ("bookmaker_key",)),
                "bookmaker_key",
                return_rows=False,
            )
        if odds_rows:
            db.upsert(
                "odds_current",
                unique_rows(odds_rows, ("event_id", "bookmaker_key", "market_key", "selection_key")),
                "event_id,bookmaker_key,market_key,selection_key",
                return_rows=False,
            )

        if event_h2h_count == 0:
            counts["events_without_h2h"] += 1

    return counts


def sync_event_markets(
    db: SupabaseRestClient,
    event_id: str,
    *,
    admin_user: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event = first(db.select("events", {"select": "*", "id": f"eq.{event_id}", "limit": "1"}))
    if not event:
        raise AppError("event_not_found", "Событие не найдено", 404)
    if event.get("source") != "odds_api" or not event.get("external_event_id"):
        raise AppError("event_markets_not_supported", "Подробные рынки можно подтянуть только для событий Odds API", 400)

    now = datetime.now(timezone.utc).isoformat()
    market_result = fetch_event_markets(event["sport_key"], event["external_event_id"])
    available_markets = sorted(
        {
            market.get("key")
            for bookmaker in market_result.get("data", {}).get("bookmakers", [])
            for market in bookmaker.get("markets", [])
            if supported_event_market(market.get("key"))
        }
    )
    if not available_markets:
        raise AppError("event_markets_empty", "Odds API не вернул доступные рынки для события", 502)

    home_team = find_team_by_raw_name(db, "odds_api", event["sport_key"], event["home_team_raw"])
    away_team = find_team_by_raw_name(db, "odds_api", event["sport_key"], event["away_team_raw"])

    counts = {
        "event_id": event_id,
        "external_event_id": event["external_event_id"],
        "sport_key": event["sport_key"],
        "available_markets_count": len(available_markets),
        "available_markets": available_markets,
        "requested_markets": [],
        "odds_count": 0,
        "bookmakers_count": 0,
        "snapshots_count": 0,
        "snapshots_note": "disabled_for_fast_sync",
        "source_bookmakers_count": 0,
        "processed_bookmakers_count": 0,
        "skipped_bookmakers_count": 0,
        "bookmaker_filter": ",".join(sync_bookmaker_keys()) or "all",
        "quota_last_total": market_result.get("quota_last") or 0,
        "quota_remaining": market_result.get("quota_remaining"),
        "quota_used": market_result.get("quota_used"),
        "request_urls": [market_result.get("request_url")],
        "regions_requested": market_result.get("regions"),
    }

    for market_chunk in chunked(available_markets, 25):
        odds_result = fetch_event_odds(event["sport_key"], event["external_event_id"], market_chunk)
        counts["requested_markets"].extend(market_chunk)
        counts["quota_last_total"] += odds_result.get("quota_last") or 0
        counts["quota_remaining"] = odds_result.get("quota_remaining")
        counts["quota_used"] = odds_result.get("quota_used")
        counts["request_urls"].append(odds_result.get("request_url"))
        source_event = odds_result.get("data") or {}
        process_event_odds_payload(
            db,
            event,
            source_event,
            home_team,
            away_team,
            now,
            counts,
        )

    db.update(
        "events",
        {
            "last_odds_sync_at": now,
            "updated_at": now,
            "raw_payload": {**(event.get("raw_payload") or {}), "detailed_markets_last_sync_at": now},
        },
        {"id": f"eq.{event_id}"},
    )
    if admin_user:
        log_admin_action(db, admin_user, "fetch_event_markets", "event", event_id, counts)
    return counts


def process_event_odds_payload(
    db: SupabaseRestClient,
    event: dict[str, Any],
    source_event: dict[str, Any],
    home_team: dict[str, Any] | None,
    away_team: dict[str, Any] | None,
    now: str,
    counts: dict[str, Any],
) -> None:
    source_bookmakers = source_event.get("bookmakers", [])
    bookmakers, filter_label = filter_bookmakers(source_bookmakers)
    counts["source_bookmakers_count"] = counts.get("source_bookmakers_count", 0) + len(source_bookmakers)
    counts["processed_bookmakers_count"] = counts.get("processed_bookmakers_count", 0) + len(bookmakers)
    counts["skipped_bookmakers_count"] = counts.get("skipped_bookmakers_count", 0) + max(0, len(source_bookmakers) - len(bookmakers))
    counts["bookmaker_filter"] = filter_label

    bookmaker_rows: list[dict[str, Any]] = []
    odds_rows: list[dict[str, Any]] = []
    for bookmaker in bookmakers:
        bookmaker_key = bookmaker["key"]
        bookmaker_rows.append(
            {"bookmaker_key": bookmaker_key, "title": bookmaker.get("title") or bookmaker_key, "updated_at": now}
        )
        counts["bookmakers_count"] += 1
        for market in bookmaker.get("markets", []):
            market_key = market.get("key")
            if not supported_event_market(market_key):
                continue
            for outcome in market.get("outcomes", []):
                odd_payload = odd_payload_for_outcome(
                    event["id"],
                    bookmaker_key,
                    market_key,
                    outcome,
                    event["home_team_raw"],
                    event["away_team_raw"],
                    home_team,
                    away_team,
                    now,
                )
                if not odd_payload:
                    continue

                odd_payload["api_last_update"] = market.get("last_update") or bookmaker.get("last_update")
                odds_rows.append(odd_payload)
                counts["odds_count"] += 1

    if bookmaker_rows:
        db.upsert(
            "bookmakers",
            unique_rows(bookmaker_rows, ("bookmaker_key",)),
            "bookmaker_key",
            return_rows=False,
        )
    if odds_rows:
        db.upsert(
            "odds_current",
            unique_rows(odds_rows, ("event_id", "bookmaker_key", "market_key", "selection_key")),
            "event_id,bookmaker_key,market_key,selection_key",
            return_rows=False,
        )


def supported_event_market(market_key: str | None) -> bool:
    if not market_key:
        return False
    if market_key.endswith("_lay"):
        return False
    return market_key not in {"outrights", "outrights_lay"}


def is_total_market(market_key: str) -> bool:
    return market_key in {"totals", "alternate_totals"} or market_key.startswith("alternate_totals_")


def is_spread_market(market_key: str) -> bool:
    return market_key in {"spreads", "alternate_spreads"} or market_key.startswith("alternate_spreads_")


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def upsert_api_event(
    db: SupabaseRestClient,
    sport_key: str,
    source_event: dict[str, Any],
    now: str,
    *,
    home_team: dict[str, Any] | None = None,
    away_team: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    home_raw = source_event["home_team"]
    away_raw = source_event["away_team"]
    if home_team is None:
        home_team = find_team_by_raw_name(db, "odds_api", sport_key, home_raw)
    if away_team is None:
        away_team = find_team_by_raw_name(db, "odds_api", sport_key, away_raw)

    return first(
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


def ensure_sports_seed(db: SupabaseRestClient, sport_keys: list[str]) -> None:
    rows = []
    for sport_key in sport_keys:
        title = SPORT_TITLES.get(
            sport_key,
            {"title_en": sport_key, "title_ru": sport_key, "group_name": "Soccer"},
        )
        rows.append(
            {
                "sport_key": sport_key,
                "title_en": title["title_en"],
                "title_ru": title["title_ru"],
                "group_name": title["group_name"],
                "is_enabled": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    db.upsert("sports", rows, "sport_key", return_rows=False)


def mark_stale_syncs(db: SupabaseRestClient) -> None:
    stale_before = (datetime.now(timezone.utc) - timedelta(minutes=SYNC_STALE_AFTER_MINUTES)).isoformat()
    stale = db.select(
        "sync_runs",
        {
            "select": "id",
            "status": "eq.started",
            "started_at": f"lt.{stale_before}",
            "limit": "100",
        },
    )
    for row in stale:
        db.update(
            "sync_runs",
            {
                "status": "error",
                "error_message": f"Sync did not finish within {SYNC_STALE_AFTER_MINUTES} minutes",
                "finished_at": datetime.now(timezone.utc).isoformat(),
            },
            {"id": f"eq.{row['id']}"},
        )


def odd_payload_for_outcome(
    event_id: str,
    bookmaker_key: str,
    market_key: str,
    outcome: dict[str, Any],
    home_raw: str,
    away_raw: str,
    home_team: dict[str, Any] | None,
    away_team: dict[str, Any] | None,
    now: str,
) -> dict[str, Any] | None:
    outcome_name = str(outcome.get("name") or "")
    price = float(outcome.get("price") or 0)
    if price <= 1:
        return None

    selection_key = ""
    selection_name_ru = ""
    selection_name_raw = outcome_name

    if market_key in {"h2h", "h2h_3_way"}:
        selection_key = selection_key_for_outcome(outcome_name, home_raw, away_raw)
        if not selection_key:
            return None
        selection_name_ru = resolve_selection_name_ru(selection_key, outcome_name, home_team, away_team)

    elif is_total_market(market_key):
        point = outcome.get("point")
        if point is None:
            return None
        line = float(point)
        line_label = format_line(line)
        if outcome_name.lower() == "over":
            selection_key = f"total_over_{line_key(line)}"
            selection_name_ru = f"ТБ {line_label}"
        elif outcome_name.lower() == "under":
            selection_key = f"total_under_{line_key(line)}"
            selection_name_ru = f"ТМ {line_label}"
        else:
            return None
        selection_name_raw = f"{outcome_name} {line_label}"

    elif is_spread_market(market_key):
        point = outcome.get("point")
        if point is None:
            return None
        line = float(point)
        line_label = format_signed_line(line)
        if outcome_name == home_raw:
            selection_key = f"handicap_home_{line_key(line)}"
            selection_name_ru = f"Ф1 ({line_label})"
        elif outcome_name == away_raw:
            selection_key = f"handicap_away_{line_key(line)}"
            selection_name_ru = f"Ф2 ({line_label})"
        else:
            return None
        selection_name_raw = f"{outcome_name} {line_label}"

    elif market_key == "double_chance":
        selection_key = double_chance_key(outcome_name, home_raw, away_raw)
        if not selection_key:
            return None
        selection_name_ru = double_chance_name(selection_key)

    else:
        selection_key = generic_selection_key(market_key, outcome)
        selection_name_ru = generic_selection_name(outcome)
        selection_name_raw = selection_name_ru

    if not selection_key:
        return None

    return {
        "event_id": event_id,
        "bookmaker_key": bookmaker_key,
        "market_key": market_key,
        "selection_key": selection_key,
        "selection_name_raw": selection_name_raw,
        "selection_name_ru": selection_name_ru,
        "price": price,
        "api_last_update": now,
        "updated_at": now,
    }


def derived_double_chance_rows(
    event_id: str,
    bookmaker_key: str,
    h2h_prices: dict[str, float],
    h2h_names: dict[str, str],
    now: str,
) -> list[dict[str, Any]]:
    required = ("home_win", "draw", "away_win")
    if any(key not in h2h_prices for key in required):
        return []

    pairs = [
        ("home_or_draw", ("home_win", "draw"), "1X"),
        ("home_or_away", ("home_win", "away_win"), "12"),
        ("draw_or_away", ("draw", "away_win"), "X2"),
    ]
    rows = []
    for selection_key, pair, label in pairs:
        implied = sum(1 / h2h_prices[key] for key in pair if h2h_prices[key] > 1)
        if implied <= 0:
            continue
        price = round(max(1.01, 1 / implied), 2)
        raw_name = " or ".join(h2h_names.get(key, key) for key in pair)
        rows.append(
            {
                "event_id": event_id,
                "bookmaker_key": bookmaker_key,
                "market_key": "double_chance",
                "selection_key": selection_key,
                "selection_name_raw": raw_name,
                "selection_name_ru": label,
                "price": price,
                "api_last_update": now,
                "updated_at": now,
            }
        )
    return rows


def double_chance_key(outcome_name: str, home_raw: str, away_raw: str) -> str | None:
    value = outcome_name.lower()
    home = home_raw.lower()
    away = away_raw.lower()
    has_home = home in value or "home" in value
    has_away = away in value or "away" in value
    has_draw = "draw" in value or "tie" in value
    if has_home and has_draw:
        return "home_or_draw"
    if has_home and has_away:
        return "home_or_away"
    if has_draw and has_away:
        return "draw_or_away"
    return None


def double_chance_name(selection_key: str) -> str:
    return {"home_or_draw": "1X", "home_or_away": "12", "draw_or_away": "X2"}.get(selection_key, selection_key)


def generic_selection_key(market_key: str, outcome: dict[str, Any]) -> str:
    parts = [
        str(outcome.get("name") or "selection"),
        str(outcome.get("description") or ""),
        str(outcome.get("point") if outcome.get("point") is not None else ""),
    ]
    raw = "_".join(part for part in parts if part).lower()
    clean = []
    for char in raw:
        if char.isalnum():
            clean.append(char)
        elif char in {".", ",", "-"}:
            clean.append(char.replace(".", "p").replace(",", "p").replace("-", "m"))
        else:
            clean.append("_")
    key = "_".join("".join(clean).split("_"))
    return f"{market_key}_{key[:80]}" if key else f"{market_key}_selection"


def generic_selection_name(outcome: dict[str, Any]) -> str:
    name = str(outcome.get("name") or "Исход")
    description = str(outcome.get("description") or "").strip()
    point = outcome.get("point")
    chunks = [name]
    if description:
        chunks.append(description)
    if point is not None:
        chunks.append(format_signed_line(float(point)))
    return " · ".join(chunks)


def line_key(value: float) -> str:
    sign = "m" if value < 0 else "p"
    return f"{sign}{abs(value):g}".replace(".", "p")


def format_line(value: float) -> str:
    return f"{value:g}".replace(".", ",")


def format_signed_line(value: float) -> str:
    prefix = "+" if value > 0 else ""
    return f"{prefix}{format_line(value)}"


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
    try:
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
    except Exception:
        return


def exception_debug(exc: Exception) -> dict[str, Any]:
    return {
        "type": exc.__class__.__name__,
        "message": str(exc),
        "traceback": "".join(format_exception(type(exc), exc, exc.__traceback__))[-5000:],
    }
