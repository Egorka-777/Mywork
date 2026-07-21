"""Shared Telethon client owner for Rewriter + Task Radar."""

from __future__ import annotations

import logging
import os
from typing import Any

from telethon import TelegramClient
from telethon.sessions import StringSession

log = logging.getLogger(__name__)


class TelegramRuntime:
    """Owns one TelegramClient for the whole Python process."""

    def __init__(self) -> None:
        self._client: TelegramClient | None = None
        self._started = False

    def _require_env(self) -> tuple[int, str, str]:
        api_id_raw = os.environ.get("TELEGRAM_API_ID", "").strip()
        api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
        session = os.environ.get("TELETHON_SESSION_STRING", "").strip()
        missing = [
            name
            for name, value in (
                ("TELEGRAM_API_ID", api_id_raw),
                ("TELEGRAM_API_HASH", api_hash),
                ("TELETHON_SESSION_STRING", session),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"Missing Telegram env: {', '.join(missing)}")
        try:
            api_id = int(api_id_raw)
        except ValueError as exc:
            raise RuntimeError("TELEGRAM_API_ID must be an integer") from exc
        return api_id, api_hash, session

    @property
    def client(self) -> TelegramClient:
        if self._client is None:
            raise RuntimeError("TelegramRuntime client is not created yet")
        return self._client

    @property
    def started(self) -> bool:
        return self._started

    def is_connected(self) -> bool:
        if self._client is None:
            return False
        try:
            return bool(self._client.is_connected())
        except Exception:
            return False

    async def start(self) -> TelegramClient:
        if self._client is not None and self._started:
            return self._client

        api_id, api_hash, session = self._require_env()
        self._client = TelegramClient(StringSession(session), api_id, api_hash)
        await self._client.start()
        self._started = True
        log.info("TelegramRuntime: connected")
        return self._client

    async def reconnect(self) -> TelegramClient:
        if self._client is not None:
            try:
                await self._client.disconnect()
            except Exception as exc:
                log.warning("TelegramRuntime disconnect before reconnect: %s", exc)
            self._client = None
            self._started = False
        return await self.start()

    async def shutdown(self) -> None:
        if self._client is None:
            return
        try:
            await self._client.disconnect()
        except Exception as exc:
            log.warning("TelegramRuntime shutdown error: %s", exc)
        finally:
            self._client = None
            self._started = False
            log.info("TelegramRuntime: shut down")

    async def get_me_safe(self) -> dict[str, Any]:
        """Return non-secret account fields for /health."""
        if not self.is_connected():
            return {"accountId": None, "username": None}
        try:
            me = await self.client.get_me()
            account_id = str(getattr(me, "id", "") or "") or None
            username = getattr(me, "username", None)
            return {"accountId": account_id, "username": username}
        except Exception as exc:
            log.warning("TelegramRuntime get_me failed: %s", exc)
            return {"accountId": None, "username": None}


# Process-wide singleton
runtime = TelegramRuntime()
