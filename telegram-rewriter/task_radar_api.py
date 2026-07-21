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
from telethon.tl.functions.channels import CheckSearchPostsFloodRequest, SearchPostsRequest
from telethon.tl.functions.messages import SearchGlobalRequest
from telethon.tl.types import (
    Channel,
    Chat,
    InputMessagesFilterEmpty,
    InputPeerChannel,
    InputPeerChat,
    InputPeerEmpty,
    InputPeerUser,
    Message,
    PeerChannel,
    PeerChat,
    PeerUser,
    User,
)

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
PUBLIC_POSTS_PAGE_LIMIT = 40
PUBLIC_POSTS_MAX_PAGES = 8
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


def _index_peers(result: Any) -> tuple[dict[int, Any], dict[int, Any]]:
    chats: dict[int, Any] = {}
    users: dict[int, Any] = {}
    for chat in getattr(result, "chats", None) or []:
        chat_id = getattr(chat, "id", None)
        if chat_id is not None:
            chats[int(chat_id)] = chat
    for user in getattr(result, "users", None) or []:
        user_id = getattr(user, "id", None)
        if user_id is not None:
            users[int(user_id)] = user
    return chats, users


def _entity_from_peer(
    peer: Any,
    chats: dict[int, Any],
    users: dict[int, Any],
) -> Any | None:
    if isinstance(peer, PeerChannel):
        return chats.get(int(peer.channel_id))
    if isinstance(peer, PeerChat):
        return chats.get(int(peer.chat_id))
    if isinstance(peer, PeerUser):
        return users.get(int(peer.user_id))
    return None


def _is_private_or_bot(entity: Any) -> bool:
    """Personal dialogs and bots are always excluded."""
    if isinstance(entity, User):
        return True
    return False


def _is_broadcast_channel(entity: Any) -> bool:
    return isinstance(entity, Channel) and bool(getattr(entity, "broadcast", False))


def _is_group_entity(entity: Any) -> bool:
    if isinstance(entity, Chat):
        return True
    if isinstance(entity, Channel) and bool(getattr(entity, "megagroup", False)):
        return True
    return False


def _entity_meta(entity: Any) -> dict[str, Any]:
    chat_id = getattr(entity, "id", None)
    title = getattr(entity, "title", None) or getattr(entity, "first_name", None)
    username = getattr(entity, "username", None)
    return {
        "chatId": str(chat_id) if chat_id is not None else None,
        "sourceTitle": title,
        "sourceUsername": username.lstrip("@") if isinstance(username, str) and username else None,
    }


def _input_peer_for_message(message: Message, chats: dict[int, Any]) -> Any:
    peer = message.peer_id
    if isinstance(peer, PeerChannel):
        channel = chats.get(int(peer.channel_id))
        access_hash = getattr(channel, "access_hash", 0) if channel is not None else 0
        return InputPeerChannel(channel_id=int(peer.channel_id), access_hash=int(access_hash or 0))
    if isinstance(peer, PeerChat):
        return InputPeerChat(chat_id=int(peer.chat_id))
    if isinstance(peer, PeerUser):
        return InputPeerUser(user_id=int(peer.user_id), access_hash=0)
    return InputPeerEmpty()


def _sender_meta_from_message(message: Message, users: dict[int, Any]) -> dict[str, Any]:
    sender_id = getattr(message, "sender_id", None)
    sender_username: str | None = None
    if sender_id is not None and int(sender_id) in users:
        user = users[int(sender_id)]
        if isinstance(user, User) and not bool(getattr(user, "bot", False)):
            sender_username = getattr(user, "username", None)
    return {
        "senderId": str(sender_id) if sender_id is not None else None,
        "senderUsername": sender_username.lstrip("@")
        if isinstance(sender_username, str) and sender_username
        else None,
    }


def _empty_stats() -> dict[str, int]:
    return {
        "keywordsChecked": 0,
        "rawFound": 0,
        "kept": 0,
        "duplicates": 0,
        "excluded": 0,
        "skippedPrivate": 0,
        "skippedOld": 0,
    }


class _SearchAccumulator:
    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []
        self.seen: set[str] = set()
        self.warnings: list[str] = []
        self.stats = _empty_stats()

    def add_message(
        self,
        *,
        message: Message,
        entity: Any,
        users: dict[int, Any],
        keyword: str,
        mode: str,
        min_date: datetime,
        exclude_keywords: list[str],
        require_public_username: bool = False,
    ) -> str:
        """Returns kept|duplicate|excluded|private|old|empty."""
        self.stats["rawFound"] += 1
        if not isinstance(message, Message):
            return "empty"
        if _is_private_or_bot(entity):
            self.stats["skippedPrivate"] += 1
            return "private"

        text = getattr(message, "message", None) or ""
        if not isinstance(text, str) or not text.strip():
            return "empty"

        published = _to_aware(getattr(message, "date", None))
        if published is None or published < min_date:
            self.stats["skippedOld"] += 1
            return "old"

        if _contains_any(_normalize_text(text), exclude_keywords):
            self.stats["excluded"] += 1
            return "excluded"

        meta = _entity_meta(entity)
        if require_public_username and not meta.get("sourceUsername"):
            self.stats["skippedPrivate"] += 1
            return "private"

        sender = _sender_meta_from_message(message, users)
        message_id = getattr(message, "id", None)
        external_id = (
            f"{meta['chatId']}:{message_id}"
            if meta.get("chatId") is not None and message_id is not None
            else None
        )
        url = _build_telegram_url(meta.get("sourceUsername"), message_id)
        fingerprint = (
            f"telegram:{external_id}"
            if external_id
            else (
                f"telegram:{url}"
                if url
                else f"telegram:{_normalize_text(text)}:{published.isoformat()}"
            )
        )
        if fingerprint in self.seen:
            self.stats["duplicates"] += 1
            return "duplicate"
        self.seen.add(fingerprint)

        self.items.append(
            {
                "id": str(uuid.uuid4()),
                "source": "telegram",
                "telegramMode": mode,
                "externalId": external_id,
                "fingerprint": fingerprint,
                "text": text.strip(),
                "publishedAt": published.isoformat(),
                "foundAt": _now_iso(),
                "dateUnknown": False,
                "chatId": meta.get("chatId"),
                "sourceTitle": meta.get("sourceTitle"),
                "sourceUsername": meta.get("sourceUsername"),
                "senderId": sender.get("senderId"),
                "senderUsername": sender.get("senderUsername"),
                "url": url,
                "matchedKeyword": keyword,
                "status": "new",
            }
        )
        self.stats["kept"] += 1
        return "kept"

    def sorted_items(self) -> list[dict[str, Any]]:
        return sorted(
            self.items,
            key=lambda item: item.get("publishedAt") or "",
            reverse=True,
        )


async def _search_public_posts(
    client: Any,
    *,
    keywords: list[str],
    exclude_keywords: list[str],
    min_date: datetime,
    limit_per_keyword: int,
    allow_paid_stars: bool,
    acc: _SearchAccumulator,
) -> None:
    for index, keyword in enumerate(keywords):
        acc.stats["keywordsChecked"] += 1
        try:
            flood = await client(CheckSearchPostsFloodRequest(query=keyword))
        except FloodWaitError as exc:
            acc.warnings.append(f"FLOOD_WAIT {exc.seconds}s (public posts / «{keyword}»)")
            settings = load_settings()
            settings["replyMode"] = "off"
            settings["autoDisabledReason"] = f"FLOOD_WAIT {exc.seconds}s"
            save_settings(settings)
            return
        except Exception as exc:
            acc.warnings.append(f"Проверка квоты SearchPosts не удалась для «{keyword}»: {exc}")
            continue

        query_is_free = bool(getattr(flood, "query_is_free", False))
        remains = int(getattr(flood, "remains", 0) or 0)
        total_daily = int(getattr(flood, "total_daily", 0) or 0)
        stars_amount = int(getattr(flood, "stars_amount", 0) or 0)
        wait_till = getattr(flood, "wait_till", None)

        paid_stars: int | None = None
        if query_is_free or remains > 0:
            paid_stars = None
        elif allow_paid_stars and stars_amount > 0:
            paid_stars = stars_amount
            acc.warnings.append(
                f"Бесплатная квота исчерпана (0/{total_daily}). "
                f"Запрос «{keyword}» выполняется с явного разрешения оплаты {stars_amount} Stars."
            )
        else:
            wait_hint = ""
            if wait_till:
                try:
                    wait_hint = (
                        f" Следующие бесплатные слоты: "
                        f"{datetime.fromtimestamp(int(wait_till), tz=timezone.utc).isoformat()}"
                    )
                except Exception:
                    wait_hint = f" wait_till={wait_till}"
            acc.warnings.append(
                f"Квота бесплатного поиска публичных постов исчерпана "
                f"(осталось 0/{total_daily}) для «{keyword}».{wait_hint} "
                f"Оплата Stars не выполняется автоматически."
            )
            if index < len(keywords) - 1:
                await asyncio.sleep(SEARCH_PAUSE_SEC)
            continue

        offset_rate = 0
        offset_peer: Any = InputPeerEmpty()
        offset_id = 0
        kept_for_keyword = 0
        page_limit = max(1, min(int(limit_per_keyword), PUBLIC_POSTS_PAGE_LIMIT))

        for page in range(PUBLIC_POSTS_MAX_PAGES):
            page_paid: int | None = None
            if page == 0:
                page_paid = paid_stars
            else:
                try:
                    page_flood = await client(CheckSearchPostsFloodRequest(query=keyword))
                except Exception as exc:
                    acc.warnings.append(f"Квота пагинации SearchPosts «{keyword}»: {exc}")
                    break
                page_free = bool(getattr(page_flood, "query_is_free", False))
                page_remains = int(getattr(page_flood, "remains", 0) or 0)
                page_stars = int(getattr(page_flood, "stars_amount", 0) or 0)
                if page_free or page_remains > 0:
                    page_paid = None
                elif allow_paid_stars and page_stars > 0:
                    page_paid = page_stars
                else:
                    acc.warnings.append(
                        f"Пагинация SearchPosts остановлена: нет бесплатной квоты для «{keyword}»"
                    )
                    break

            try:
                result = await client(
                    SearchPostsRequest(
                        offset_rate=offset_rate,
                        offset_peer=offset_peer,
                        offset_id=offset_id,
                        limit=page_limit,
                        query=keyword,
                        hashtag=None,
                        allow_paid_stars=page_paid,
                    )
                )
            except FloodWaitError as exc:
                acc.warnings.append(f"FLOOD_WAIT {exc.seconds}s on SearchPosts «{keyword}»")
                settings = load_settings()
                settings["replyMode"] = "off"
                settings["autoDisabledReason"] = f"FLOOD_WAIT {exc.seconds}s"
                save_settings(settings)
                return
            except Exception as exc:
                acc.warnings.append(f"SearchPosts failed for «{keyword}»: {exc}")
                break

            messages = [m for m in (getattr(result, "messages", None) or []) if isinstance(m, Message)]
            if not messages:
                break

            chats, users = _index_peers(result)
            page_dates: list[datetime] = []
            for message in messages:
                published = _to_aware(getattr(message, "date", None))
                if published is not None:
                    page_dates.append(published)
                entity = _entity_from_peer(message.peer_id, chats, users)
                if entity is None:
                    continue
                if not _is_broadcast_channel(entity) and not isinstance(entity, Channel):
                    # SearchPosts should be channels; still drop users/bots.
                    if _is_private_or_bot(entity):
                        acc.stats["skippedPrivate"] += 1
                        continue
                status = acc.add_message(
                    message=message,
                    entity=entity,
                    users=users,
                    keyword=keyword,
                    mode="public_posts",
                    min_date=min_date,
                    exclude_keywords=exclude_keywords,
                    require_public_username=False,
                )
                if status == "kept":
                    kept_for_keyword += 1

            if kept_for_keyword >= limit_per_keyword:
                break
            if not page_dates:
                break
            oldest = min(page_dates)
            if oldest < min_date:
                break

            last = messages[-1]
            next_rate = getattr(result, "next_rate", None)
            if next_rate is not None:
                offset_rate = int(next_rate)
            elif last.date is not None:
                offset_rate = int(_to_aware(last.date).timestamp())  # type: ignore[union-attr]
            offset_id = int(last.id)
            offset_peer = _input_peer_for_message(last, chats)
            await asyncio.sleep(SEARCH_PAUSE_SEC)

        if index < len(keywords) - 1:
            await asyncio.sleep(SEARCH_PAUSE_SEC)


async def _search_public_groups(
    client: Any,
    *,
    keywords: list[str],
    exclude_keywords: list[str],
    min_date: datetime,
    limit_per_keyword: int,
    acc: _SearchAccumulator,
) -> None:
    for index, keyword in enumerate(keywords):
        acc.stats["keywordsChecked"] += 1
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
                    broadcasts_only=False,
                    groups_only=True,
                    users_only=False,
                )
            )
        except FloodWaitError as exc:
            acc.warnings.append(f"FLOOD_WAIT {exc.seconds}s on public groups «{keyword}»")
            settings = load_settings()
            settings["replyMode"] = "off"
            settings["autoDisabledReason"] = f"FLOOD_WAIT {exc.seconds}s"
            save_settings(settings)
            return
        except Exception as exc:
            acc.warnings.append(f"SearchGlobal groups_only failed for «{keyword}»: {exc}")
            continue

        chats, users = _index_peers(result)
        for message in getattr(result, "messages", None) or []:
            if not isinstance(message, Message):
                continue
            entity = _entity_from_peer(message.peer_id, chats, users)
            if entity is None:
                continue
            if _is_private_or_bot(entity) or not _is_group_entity(entity):
                acc.stats["skippedPrivate"] += 1
                continue
            acc.add_message(
                message=message,
                entity=entity,
                users=users,
                keyword=keyword,
                mode="public_groups",
                min_date=min_date,
                exclude_keywords=exclude_keywords,
            )

        if index < len(keywords) - 1:
            await asyncio.sleep(SEARCH_PAUSE_SEC)


async def _search_my_sources(
    client: Any,
    *,
    keywords: list[str],
    exclude_keywords: list[str],
    min_date: datetime,
    limit_per_keyword: int,
    sources: list[dict[str, Any]],
    acc: _SearchAccumulator,
) -> None:
    active_sources = []
    for row in sources:
        if not isinstance(row, dict):
            continue
        if row.get("active") is False:
            continue
        username = str(row.get("username") or "").strip().lstrip("@")
        if username:
            active_sources.append(username)

    if not active_sources:
        acc.warnings.append("Мои источники: список пуст или все выключены")
        return

    for source in active_sources:
        try:
            entity = await client.get_entity(source)
        except Exception as exc:
            acc.warnings.append(f"Не удалось открыть источник @{source}: {exc}")
            continue

        if _is_private_or_bot(entity):
            acc.warnings.append(f"Источник @{source} пропущен: личный диалог/бот")
            continue

        for index, keyword in enumerate(keywords):
            acc.stats["keywordsChecked"] += 1
            try:
                messages = await client.get_messages(
                    entity,
                    limit=max(1, min(int(limit_per_keyword), 50)),
                    search=keyword,
                )
            except FloodWaitError as exc:
                acc.warnings.append(f"FLOOD_WAIT {exc.seconds}s on my source @{source}")
                settings = load_settings()
                settings["replyMode"] = "off"
                settings["autoDisabledReason"] = f"FLOOD_WAIT {exc.seconds}s"
                save_settings(settings)
                return
            except Exception as exc:
                acc.warnings.append(f"Поиск в @{source} / «{keyword}» не удался: {exc}")
                continue

            users: dict[int, Any] = {}
            for message in messages or []:
                if not isinstance(message, Message):
                    continue
                published = _to_aware(getattr(message, "date", None))
                if published is not None and published < min_date:
                    acc.stats["skippedOld"] += 1
                    continue
                acc.add_message(
                    message=message,
                    entity=entity,
                    users=users,
                    keyword=keyword,
                    mode="my_sources",
                    min_date=min_date,
                    exclude_keywords=exclude_keywords,
                )

            if index < len(keywords) - 1:
                await asyncio.sleep(SEARCH_PAUSE_SEC)

        await asyncio.sleep(SEARCH_PAUSE_SEC)


async def search_telegram(
    runtime: TelegramRuntime,
    *,
    keywords: list[str],
    exclude_keywords: list[str],
    max_age_minutes: int,
    limit_per_keyword: int,
    public_posts: bool = True,
    public_groups: bool = False,
    my_sources: bool = False,
    sources: list[dict[str, Any]] | None = None,
    allow_paid_stars: bool = False,
) -> dict[str, Any]:
    if not runtime.is_connected():
        return {
            "ok": False,
            "items": [],
            "stats": _empty_stats(),
            "warnings": ["Telegram is not connected"],
            "error": "telegram_disconnected",
        }

    if not (public_posts or public_groups or my_sources):
        return {
            "ok": False,
            "items": [],
            "stats": _empty_stats(),
            "warnings": ["Не выбран ни один режим Telegram-поиска"],
            "error": "no_telegram_mode",
        }

    client = runtime.client
    min_date = datetime.now(timezone.utc) - timedelta(minutes=max(1, int(max_age_minutes)))
    clean_keywords = [k.strip() for k in keywords if isinstance(k, str) and k.strip()]
    clean_excludes = [k.strip() for k in exclude_keywords if isinstance(k, str) and k.strip()]
    acc = _SearchAccumulator()

    if not clean_keywords:
        return {
            "ok": False,
            "items": [],
            "stats": _empty_stats(),
            "warnings": ["Список ключей пуст"],
            "error": "no_keywords",
        }

    # Independent modes — never mixed into one SearchGlobal call.
    if public_posts:
        await _search_public_posts(
            client,
            keywords=clean_keywords,
            exclude_keywords=clean_excludes,
            min_date=min_date,
            limit_per_keyword=limit_per_keyword,
            allow_paid_stars=bool(allow_paid_stars),
            acc=acc,
        )
    if public_groups:
        await _search_public_groups(
            client,
            keywords=clean_keywords,
            exclude_keywords=clean_excludes,
            min_date=min_date,
            limit_per_keyword=limit_per_keyword,
            acc=acc,
        )
    if my_sources:
        await _search_my_sources(
            client,
            keywords=clean_keywords,
            exclude_keywords=clean_excludes,
            min_date=min_date,
            limit_per_keyword=limit_per_keyword,
            sources=sources or [],
            acc=acc,
        )

    items = acc.sorted_items()
    return {
        "ok": True,
        "items": items,
        "stats": {
            **acc.stats,
            "kept": len(items),
        },
        "warnings": acc.warnings,
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

        public_posts = body.get("telegramPublicPostsEnabled")
        if public_posts is None:
            public_posts = settings.get("telegramPublicPostsEnabled", True)
        public_groups = body.get("telegramPublicGroupsEnabled")
        if public_groups is None:
            public_groups = settings.get("telegramPublicGroupsEnabled", False)
        my_sources = body.get("telegramMySourcesEnabled")
        if my_sources is None:
            my_sources = settings.get("telegramMySourcesEnabled", False)

        sources = body.get("telegramSources")
        if not isinstance(sources, list):
            sources = settings.get("telegramSources") or []

        allow_paid = body.get("allowPaidStarsSearch")
        if allow_paid is None:
            allow_paid = settings.get("allowPaidStarsSearch", False)

        result = await search_telegram(
            runtime,
            keywords=[str(k) for k in keywords],
            exclude_keywords=[str(k) for k in exclude],
            max_age_minutes=max_age,
            limit_per_keyword=limit,
            public_posts=bool(public_posts),
            public_groups=bool(public_groups),
            my_sources=bool(my_sources),
            sources=[s for s in sources if isinstance(s, dict)],
            allow_paid_stars=bool(allow_paid),
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
