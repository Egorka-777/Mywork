"""Local HTTP API for Task Radar Telegram search + auto-reply send."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from aiohttp import web
from telethon.errors import FloodWaitError
from telethon.tl.functions.messages import SearchGlobalRequest
from telethon.tl.types import InputMessagesFilterEmpty, InputPeerEmpty

from task_radar_store import (
    append_jsonl,
    find_item,
    load_replies,
    load_settings,
    replies_path,
    save_settings,
    update_item,
)
from telegram_runtime import TelegramRuntime

log = logging.getLogger(__name__)

SEARCH_PAUSE_SEC = float(os.environ.get("TASK_RADAR_SEARCH_PAUSE_SEC", "1.2"))
PEER_COOLDOWN_DAYS = 7
MIN_AUTO_GAP_SEC = 90


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _contains_any(haystack: str, needles: list[str]) -> str | None:
    for needle in needles:
        n = needle.strip().lower()
        if n and n in haystack:
            return needle.strip()
    return None


def _to_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _build_telegram_url(username: str | None, message_id: int | None) -> str | None:
    if not username or not message_id:
        return None
    clean = username.lstrip("@")
    if not clean:
        return None
    return f"https://t.me/{clean}/{message_id}"


async def _resolve_chat_meta(client: Any, message: Any) -> dict[str, Any]:
    chat = getattr(message, "chat", None)
    peer_id = getattr(message, "peer_id", None)
    chat_id: int | None = None
    title: str | None = None
    username: str | None = None

    if chat is not None:
        chat_id = getattr(chat, "id", None)
        title = getattr(chat, "title", None) or getattr(chat, "first_name", None)
        username = getattr(chat, "username", None)
    elif peer_id is not None:
        chat_id = getattr(peer_id, "channel_id", None) or getattr(peer_id, "chat_id", None) or getattr(
            peer_id, "user_id", None
        )

    if (title is None or username is None) and chat_id is not None:
        try:
            entity = await client.get_entity(chat_id)
            title = title or getattr(entity, "title", None) or getattr(entity, "first_name", None)
            username = username or getattr(entity, "username", None)
        except Exception:
            pass

    return {
        "chatId": str(chat_id) if chat_id is not None else None,
        "sourceTitle": title,
        "sourceUsername": username.lstrip("@") if isinstance(username, str) and username else None,
    }


async def _resolve_sender_meta(client: Any, message: Any) -> dict[str, Any]:
    sender_id = getattr(message, "sender_id", None)
    sender_username: str | None = None
    sender = getattr(message, "sender", None)
    if sender is not None:
        sender_username = getattr(sender, "username", None)
        if sender_id is None:
            sender_id = getattr(sender, "id", None)
    if sender_username is None and sender_id is not None:
        try:
            entity = await client.get_entity(sender_id)
            sender_username = getattr(entity, "username", None)
        except Exception:
            pass
    return {
        "senderId": str(sender_id) if sender_id is not None else None,
        "senderUsername": sender_username.lstrip("@") if isinstance(sender_username, str) and sender_username else None,
    }


async def search_telegram(
    runtime: TelegramRuntime,
    *,
    keywords: list[str],
    exclude_keywords: list[str],
    max_age_minutes: int,
    limit_per_keyword: int,
) -> dict[str, Any]:
    if not runtime.is_connected():
        return {
            "ok": False,
            "items": [],
            "stats": {
                "keywordsChecked": 0,
                "rawFound": 0,
                "kept": 0,
                "duplicates": 0,
                "excluded": 0,
            },
            "warnings": ["Telegram is not connected"],
            "error": "telegram_disconnected",
        }

    client = runtime.client
    now = datetime.now(timezone.utc)
    min_date = now - timedelta(minutes=max(1, int(max_age_minutes)))
    warnings: list[str] = []
    raw_found = 0
    kept = 0
    duplicates = 0
    excluded = 0
    seen: set[str] = set()
    items: list[dict[str, Any]] = []

    clean_keywords = [k.strip() for k in keywords if isinstance(k, str) and k.strip()]
    clean_excludes = [k.strip() for k in exclude_keywords if isinstance(k, str) and k.strip()]

    for index, keyword in enumerate(clean_keywords):
        try:
            result = await client(
                SearchGlobalRequest(
                    q=keyword,
                    filter=InputMessagesFilterEmpty(),
                    min_date=min_date,
                    max_date=None,
                    offset_rate=0,
                    offset_peer=InputPeerEmpty(),
                    offset_id=0,
                    limit=max(1, min(int(limit_per_keyword), 50)),
                )
            )
        except FloodWaitError as exc:
            warnings.append(f"FLOOD_WAIT {exc.seconds}s on keyword «{keyword}»")
            settings = load_settings()
            settings["replyMode"] = "off"
            settings["autoDisabledReason"] = f"FLOOD_WAIT {exc.seconds}s"
            save_settings(settings)
            break
        except Exception as exc:
            warnings.append(f"Search failed for «{keyword}»: {exc}")
            continue

        messages = getattr(result, "messages", None) or []
        for message in messages:
            raw_found += 1
            text = getattr(message, "message", None) or ""
            if not isinstance(text, str) or not text.strip():
                continue

            published = _to_aware(getattr(message, "date", None))
            if published is None or published < min_date:
                continue

            normalized = _normalize_text(text)
            hit_exclude = _contains_any(normalized, clean_excludes)
            if hit_exclude:
                excluded += 1
                continue
            if keyword.lower() not in normalized:
                # Global search can be fuzzy; keep only clear keyword hits.
                excluded += 1
                continue

            chat_meta = await _resolve_chat_meta(client, message)
            sender_meta = await _resolve_sender_meta(client, message)
            message_id = getattr(message, "id", None)
            external_id = (
                f"{chat_meta['chatId']}:{message_id}"
                if chat_meta.get("chatId") is not None and message_id is not None
                else None
            )
            url = _build_telegram_url(chat_meta.get("sourceUsername"), message_id)
            fingerprint = (
                f"telegram:{external_id}"
                if external_id
                else (f"telegram:{url}" if url else f"telegram:{normalized}:{published.isoformat()}")
            )
            if fingerprint in seen:
                duplicates += 1
                continue
            seen.add(fingerprint)

            items.append(
                {
                    "id": str(uuid.uuid4()),
                    "source": "telegram",
                    "externalId": external_id,
                    "fingerprint": fingerprint,
                    "text": text.strip(),
                    "publishedAt": published.isoformat(),
                    "foundAt": _now_iso(),
                    "dateUnknown": False,
                    "chatId": chat_meta.get("chatId"),
                    "sourceTitle": chat_meta.get("sourceTitle"),
                    "sourceUsername": chat_meta.get("sourceUsername"),
                    "senderId": sender_meta.get("senderId"),
                    "senderUsername": sender_meta.get("senderUsername"),
                    "url": url,
                    "matchedKeyword": keyword,
                    "status": "new",
                }
            )
            kept += 1

        if index < len(clean_keywords) - 1:
            await asyncio.sleep(SEARCH_PAUSE_SEC)

    return {
        "ok": True,
        "items": items,
        "stats": {
            "keywordsChecked": len(clean_keywords),
            "rawFound": raw_found,
            "kept": kept,
            "duplicates": duplicates,
            "excluded": excluded,
        },
        "warnings": warnings,
    }


def _count_recent_replies(replies: list[dict[str, Any]], *, seconds: int) -> int:
    cutoff = time.time() - seconds
    count = 0
    for row in replies:
        if row.get("ok") is False:
            continue
        ts = row.get("sentAt") or row.get("at")
        if not isinstance(ts, str):
            continue
        try:
            sent = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        if sent >= cutoff:
            count += 1
    return count


def _peer_in_cooldown(replies: list[dict[str, Any]], peer_key: str) -> bool:
    cutoff = time.time() - PEER_COOLDOWN_DAYS * 24 * 3600
    for row in replies:
        if row.get("peerKey") != peer_key:
            continue
        if row.get("ok") is False:
            continue
        ts = row.get("sentAt") or row.get("at")
        if not isinstance(ts, str):
            continue
        try:
            sent = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        if sent >= cutoff:
            return True
    return False


def _last_send_too_soon(replies: list[dict[str, Any]]) -> bool:
    latest = 0.0
    for row in replies:
        if row.get("ok") is False:
            continue
        ts = row.get("sentAt") or row.get("at")
        if not isinstance(ts, str):
            continue
        try:
            sent = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        latest = max(latest, sent)
    return latest > 0 and (time.time() - latest) < MIN_AUTO_GAP_SEC


async def send_reply(runtime: TelegramRuntime, body: dict[str, Any]) -> dict[str, Any]:
    settings = load_settings()
    if settings.get("replyMode") != "auto":
        return {"ok": False, "error": "auto_reply_disabled"}

    item_id = str(body.get("itemId") or "").strip()
    text = str(body.get("text") or "").strip()
    if not item_id:
        return {"ok": False, "error": "item_id_required"}
    if not text:
        return {"ok": False, "error": "text_required"}

    item = find_item(item_id)
    if item is None:
        return {"ok": False, "error": "item_not_found"}
    if item.get("status") == "replied":
        return {"ok": False, "error": "already_replied"}

    replies = load_replies()
    max_hour = int(settings.get("maxAutoPerHour") or 5)
    max_day = int(settings.get("maxAutoPerDay") or 20)
    if _count_recent_replies(replies, seconds=3600) >= max_hour:
        return {"ok": False, "error": "hour_limit"}
    if _count_recent_replies(replies, seconds=86400) >= max_day:
        return {"ok": False, "error": "day_limit"}
    if _last_send_too_soon(replies):
        return {"ok": False, "error": "gap_limit"}

    env = settings.get("autoEnvironment") or "test"
    test_username = os.environ.get("TASK_RADAR_TEST_USERNAME", "").strip().lstrip("@")

    if env == "test":
        if not test_username:
            return {"ok": False, "error": "test_username_missing"}
        target = test_username
        peer_key = f"user:{test_username.lower()}"
    else:
        if not settings.get("autoLiveConfirmed"):
            return {"ok": False, "error": "live_not_confirmed"}
        sender_username = item.get("senderUsername")
        sender_id = item.get("senderId")
        if sender_username:
            target = str(sender_username).lstrip("@")
            peer_key = f"user:{target.lower()}"
        elif sender_id:
            target = int(sender_id) if str(sender_id).isdigit() else sender_id
            peer_key = f"id:{sender_id}"
        else:
            return {"ok": False, "error": "no_sender_peer"}

    if _peer_in_cooldown(replies, peer_key):
        return {"ok": False, "error": "peer_cooldown"}

    if not runtime.is_connected():
        return {"ok": False, "error": "telegram_disconnected"}

    try:
        entity = await runtime.client.get_entity(target)
        await runtime.client.send_message(entity, text)
    except FloodWaitError as exc:
        settings["replyMode"] = "off"
        settings["autoDisabledReason"] = f"FLOOD_WAIT {exc.seconds}s"
        save_settings(settings)
        append_jsonl(
            replies_path(),
            {
                "ok": False,
                "itemId": item_id,
                "peerKey": peer_key,
                "error": "FLOOD_WAIT",
                "seconds": exc.seconds,
                "at": _now_iso(),
            },
        )
        return {"ok": False, "error": "flood_wait", "seconds": exc.seconds}
    except Exception as exc:
        append_jsonl(
            replies_path(),
            {
                "ok": False,
                "itemId": item_id,
                "peerKey": peer_key,
                "error": str(exc),
                "at": _now_iso(),
            },
        )
        return {"ok": False, "error": "send_failed", "detail": str(exc)}

    append_jsonl(
        replies_path(),
        {
            "ok": True,
            "itemId": item_id,
            "peerKey": peer_key,
            "environment": env,
            "sentAt": _now_iso(),
        },
    )
    update_item(item_id, {"status": "replied", "repliedAt": _now_iso()})
    return {"ok": True, "itemId": item_id, "environment": env}


def create_app(runtime: TelegramRuntime) -> web.Application:
    app = web.Application()

    async def health(_request: web.Request) -> web.Response:
        me = await runtime.get_me_safe()
        return web.json_response(
            {
                "ok": True,
                "telegramConnected": runtime.is_connected(),
                "accountId": me.get("accountId"),
                "username": me.get("username"),
            }
        )

    async def search(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        settings = load_settings()
        keywords = body.get("keywords")
        if not isinstance(keywords, list) or not keywords:
            keywords = settings.get("keywords") or []
        exclude = body.get("excludeKeywords")
        if not isinstance(exclude, list):
            exclude = settings.get("excludeKeywords") or []
        max_age = int(body.get("maxAgeMinutes") or settings.get("maxAgeMinutes") or 180)
        limit = int(body.get("limitPerKeyword") or 30)

        result = await search_telegram(
            runtime,
            keywords=[str(k) for k in keywords],
            exclude_keywords=[str(k) for k in exclude],
            max_age_minutes=max_age,
            limit_per_keyword=limit,
        )
        return web.json_response(result)

    async def send_reply_handler(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        result = await send_reply(runtime, body)
        status = 200 if result.get("ok") else 400
        return web.json_response(result, status=status)

    app.router.add_get("/health", health)
    app.router.add_post("/search", search)
    app.router.add_post("/send-reply", send_reply_handler)
    return app


async def start_task_radar_api(runtime: TelegramRuntime) -> web.AppRunner:
    host = os.environ.get("TASK_RADAR_TELEGRAM_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.environ.get("TASK_RADAR_TELEGRAM_PORT", "8792"))
    app = create_app(runtime)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host=host, port=port)
    await site.start()
    log.info("Task Radar Telegram API on http://%s:%s", host, port)
    return runner
