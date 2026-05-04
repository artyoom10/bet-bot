import os


SPORT_KEYS = [
    "soccer_russia_premier_league",
    "soccer_spain_la_liga",
    "soccer_uefa_champs_league",
    "icehockey_nhl",
]


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def env_bool(name: str, default: bool = False) -> bool:
    value = env(name)
    if not value:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def admin_tg_ids() -> set[str]:
    return {item.strip() for item in env("ADMIN_TELEGRAM_IDS").split(",") if item.strip()}


def app_name() -> str:
    return env("APP_NAME", "Demo Bet")
