from __future__ import annotations

import os
from typing import Any

import requests

from lib.errors import AppError


class SupabaseRestClient:
    def __init__(self):
        self.url = os.getenv("SUPABASE_URL", "").rstrip("/")
        self.key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    @property
    def configured(self) -> bool:
        return bool(self.url and self.key)

    def request(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        if not self.configured:
            raise AppError("supabase_not_configured", "Supabase variables are not configured", 500)

        request_headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if headers:
            request_headers.update(headers)

        response = requests.request(
            method,
            f"{self.url}/rest/v1/{table}",
            params=params or {},
            json=json,
            headers=request_headers,
            timeout=25,
        )

        if response.status_code >= 400:
            raise AppError(
                "supabase_error",
                f"Supabase returned {response.status_code}: {response.text[:400]}",
                502,
            )

        if response.status_code == 204 or not response.text:
            return []

        return response.json()

    def select(self, table: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        return self.request("GET", table, params=params)

    def insert(
        self,
        table: str,
        payload: dict[str, Any] | list[dict[str, Any]],
        *,
        return_rows: bool = True,
    ) -> list[dict[str, Any]]:
        return self.request(
            "POST",
            table,
            json=payload,
            headers={"Prefer": "return=representation" if return_rows else "return=minimal"},
        )

    def upsert(
        self,
        table: str,
        payload: dict[str, Any] | list[dict[str, Any]],
        on_conflict: str,
        *,
        return_rows: bool = True,
    ) -> list[dict[str, Any]]:
        return self.request(
            "POST",
            table,
            params={"on_conflict": on_conflict},
            json=payload,
            headers={
                "Prefer": "resolution=merge-duplicates,return=representation"
                if return_rows
                else "resolution=merge-duplicates,return=minimal"
            },
        )

    def update(
        self,
        table: str,
        payload: dict[str, Any],
        params: dict[str, Any],
        *,
        return_rows: bool = True,
    ) -> list[dict[str, Any]]:
        return self.request(
            "PATCH",
            table,
            params=params,
            json=payload,
            headers={"Prefer": "return=representation" if return_rows else "return=minimal"},
        )

    def delete(self, table: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        return self.request(
            "DELETE",
            table,
            params=params,
            headers={"Prefer": "return=representation"},
        )


def get_db() -> SupabaseRestClient:
    return SupabaseRestClient()
