from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _parse_env_file(env_path: Path) -> dict[str, str]:
    if not env_path.exists():
        return {}

    result: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip("'").strip('"')
        result[key.strip()] = value
    return result


@dataclass(slots=True)
class SupabaseConfig:
    url: str
    publishable_key: str
    secret_key: str

    @property
    def rest_url(self) -> str:
        return f"{self.url.rstrip('/')}/rest/v1"

    @property
    def anon_headers(self) -> dict[str, str]:
        return {
            "apikey": self.publishable_key,
            "Authorization": f"Bearer {self.publishable_key}",
            "Content-Type": "application/json",
        }

    @property
    def service_headers(self) -> dict[str, str]:
        return {
            "apikey": self.secret_key,
            "Authorization": f"Bearer {self.secret_key}",
            "Content-Type": "application/json",
        }


class SupabaseError(RuntimeError):
    pass


class SupabaseRestClient:
    def __init__(self, config: SupabaseConfig, use_service_role: bool = True) -> None:
        self.config = config
        self.headers = config.service_headers if use_service_role else config.anon_headers

    @classmethod
    def from_root(cls, root_dir: Path, use_service_role: bool = True) -> "SupabaseRestClient | None":
        env = _parse_env_file(root_dir / ".env")
        url = env.get("SUPABASE_URL", "").strip()
        publishable = env.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
        secret = env.get("SUPABASE_SECRET_KEY", "").strip()
        if not url or not publishable or not secret:
            return None
        return cls(
            SupabaseConfig(
                url=url,
                publishable_key=publishable,
                secret_key=secret,
            ),
            use_service_role=use_service_role,
        )

    def is_configured(self) -> bool:
        return bool(self.config.url and self.config.secret_key)

    def _request(
        self,
        method: str,
        table: str,
        *,
        query: dict[str, Any] | None = None,
        body: Any | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> tuple[int, bytes, dict[str, str]]:
        query_string = ""
        if query:
            filtered = {key: value for key, value in query.items() if value is not None}
            if filtered:
                query_string = f"?{urlencode(filtered, doseq=True)}"

        payload = None
        if body is not None:
            payload = json.dumps(body).encode("utf-8")

        headers = dict(self.headers)
        if extra_headers:
            headers.update(extra_headers)

        request = Request(
            f"{self.config.rest_url}/{table}{query_string}",
            data=payload,
            headers=headers,
            method=method,
        )

        try:
            with urlopen(request, timeout=20) as response:
                return response.status, response.read(), dict(response.headers.items())
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise SupabaseError(f"Supabase HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise SupabaseError(f"Supabase connection failed: {exc.reason}") from exc

    def select_rows(
        self,
        table: str,
        *,
        select: str = "*",
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"select": select}
        if filters:
            query.update(filters)
        if order:
            query["order"] = order
        if limit is not None:
            query["limit"] = limit
        _status, raw, _headers = self._request("GET", table, query=query)
        if not raw:
            return []
        return json.loads(raw.decode("utf-8"))

    def count_rows(self, table: str, *, filters: dict[str, str] | None = None) -> int:
        query: dict[str, Any] = {"select": "id", "limit": 1}
        if filters:
            query.update(filters)
        _status, _raw, headers = self._request(
            "GET",
            table,
            query=query,
            extra_headers={"Prefer": "count=exact"},
        )
        content_range = headers.get("Content-Range", "")
        if "/" not in content_range:
            return 0
        return int(content_range.split("/")[-1] or "0")

    def insert_rows(
        self,
        table: str,
        rows: list[dict[str, Any]] | dict[str, Any],
        *,
        returning: bool = True,
    ) -> list[dict[str, Any]]:
        prefer = "return=representation" if returning else "return=minimal"
        _status, raw, _headers = self._request(
            "POST",
            table,
            body=rows,
            extra_headers={"Prefer": prefer},
        )
        if not returning or not raw:
            return []
        return json.loads(raw.decode("utf-8"))

    def upsert_rows(
        self,
        table: str,
        rows: list[dict[str, Any]] | dict[str, Any],
        *,
        on_conflict: str,
        returning: bool = True,
    ) -> list[dict[str, Any]]:
        prefer = "resolution=merge-duplicates"
        prefer = f"{prefer},return=representation" if returning else f"{prefer},return=minimal"
        _status, raw, _headers = self._request(
            "POST",
            table,
            query={"on_conflict": on_conflict},
            body=rows,
            extra_headers={"Prefer": prefer},
        )
        if not returning or not raw:
            return []
        return json.loads(raw.decode("utf-8"))

    def update_rows(
        self,
        table: str,
        row: dict[str, Any],
        *,
        filters: dict[str, str],
        returning: bool = True,
    ) -> list[dict[str, Any]]:
        prefer = "return=representation" if returning else "return=minimal"
        _status, raw, _headers = self._request(
            "PATCH",
            table,
            query=filters,
            body=row,
            extra_headers={"Prefer": prefer},
        )
        if not returning or not raw:
            return []
        return json.loads(raw.decode("utf-8"))

    def delete_rows(self, table: str, *, filters: dict[str, str]) -> None:
        self._request("DELETE", table, query=filters, extra_headers={"Prefer": "return=minimal"})
