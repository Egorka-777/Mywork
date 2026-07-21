import asyncio
import json
import logging
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv
from openai import AsyncOpenAI
from telethon import TelegramClient
from telethon.extensions import html as tl_html
from telethon.tl.types import (
    MessageMediaDocument,
    MessageMediaPhoto,
)

from task_radar_api import start_task_radar_api
from telegram_runtime import runtime as telegram_runtime

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

GROQ_API_KEY = os.environ["GROQ_API_KEY"]
BOT_TOKEN = os.environ["BOT_TOKEN"]
TARGET_CHAT_ID = os.environ["TARGET_CHAT_ID"]
SOURCE_CHANNELS_RAW = os.environ.get(
    "SOURCE_CHANNELS",
    "@kirillbezikov,@ungurenko_adout_digital,@artamonov_proreels,@blogoputiteyhana,@mirneyrosetey,"
    "@zolootykh,@ai_innovate_agency,@artem_kotelnikovv,@pasha_production1,@ReelsAcademyPotapovfx,"
    "@Evdo_kimova,@sadekovsasha,@saveliylenivin,@anjela_p,@reelsarkazi,@big_bad_coach,"
    "@maksim_and_ai,@belyakAi",
)

SOURCE_CHANNELS = [ch.strip() for ch in SOURCE_CHANNELS_RAW.split(",") if ch.strip()]

STATE_FILE = Path("state.json")
MIN_POST_LENGTH = 100
POLL_INTERVAL = 60
INITIAL_POSTS_PER_CHANNEL = 3
MAX_MEDIA_BYTES = 50 * 1024 * 1024  # 50 MB — Bot API upload limit

BOT_API_URL = f"https://api.telegram.org/bot{BOT_TOKEN}"

openai_client = AsyncOpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1",
)


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            log.warning(f"Could not load state.json: {e}. Starting fresh.")
    return {}


def save_state(state: dict) -> None:
    try:
        # Preserve control keys written externally (e.g. tracker_enabled from workbench UI)
        # to avoid race condition where bot's in-memory state overwrites UI changes
        CONTROL_KEYS = ("tracker_enabled",)
        if STATE_FILE.exists():
            try:
                existing = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                for key in CONTROL_KEYS:
                    if key in existing and key not in state:
                        state[key] = existing[key]
            except Exception:
                pass
        STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        log.error(f"Could not save state.json: {e}")


def is_tracker_enabled(_state: dict | None = None) -> bool:
    """Читает tracker_enabled напрямую с диска — защита от гонки с UI."""
    try:
        if STATE_FILE.exists():
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            return data.get("tracker_enabled", True)
    except Exception:
        pass
    return True


def is_bootstrap_done(state: dict) -> bool:
    return state.get("__bootstrapped__", False)


def mark_bootstrap_done(state: dict) -> dict:
    state["__bootstrapped__"] = True
    return state


def message_to_html(message) -> str:
    """Convert Telethon message text + entities to Telegram HTML."""
    raw = message.message or ""
    entities = message.entities or []
    try:
        return tl_html.unparse(raw, entities)
    except Exception:
        return raw


async def rewrite_post(html_text: str, channel_title: str) -> str | None:
    system_prompt = """Ты — профессиональный редактор Telegram-каналов.

Твоя задача — взять исходный пост и переписать его так, чтобы он читался легче, быстрее и интереснее, чем оригинал.
Ты не пересказываешь текст и не делаешь нейросетевой рерайт. Ты собираешь сильный Telegram-пост.

Цель: сохранить смысл исходного текста, но сделать подачу более живой, читаемой и цепкой.

Требования к тексту:

— короткие абзацы
— простой разговорный язык
— хороший ритм чтения
— высокая читаемость с телефона
— плотный текст без воды
— ощущение, что текст писал человек

Как строить пост:

1. Начни с сильной мысли или вопроса (hook), который цепляет внимание.
2. Дальше раскрой мысль простыми короткими абзацами.
3. Веди читателя логично: мысль → пояснение → усиление.
4. Важные мысли можно выносить в отдельную строку.
5. Текст должен легко сканироваться глазами.

Чего нельзя делать:

— нельзя писать сухо
— нельзя пересказывать академически
— нельзя писать длинными предложениями
— нельзя использовать штампы вроде:
"в современном мире"
"информация вокруг нас"
"действительно"
"следует отметить"
"таким образом"
— нельзя делать текст более скучным, чем оригинал
— нельзя писать как статья или блог

Важно:

Если исходный текст уже хорошо написан, не ухудшай его.
Твоя задача — сохранить уровень или сделать текст сильнее.

Стиль:

— уверенный
— простой
— разговорный
— без пафоса
— без инфоцыганских формулировок
— без канцелярита

Форматирование — ОБЯЗАТЕЛЬНО:

Входной текст может содержать HTML-теги Telegram: <b>, <i>, <u>, <s>, <code>, <pre>, <a href>, <tg-spoiler>.
Также в тексте могут быть эмодзи.

Ты ОБЯЗАН в переписанном посте использовать аналогичные элементы оформления:
— Если в оригинале есть <b>жирный</b> — используй жирный для ключевых мыслей.
— Если в оригинале есть <i>курсив</i> — используй курсив для акцентов или цитат.
— Если в оригинале есть <tg-spoiler>спойлер</tg-spoiler> — используй спойлеры там, где это усиливает интригу.
— Если в оригинале есть эмодзи — используй эмодзи в похожем количестве и в похожих местах.
— Сохраняй визуальный ритм оформления: если оригинал структурирован списком с эмодзи, делай так же.

Формат ответа:

— только готовый переписанный пост в HTML-разметке Telegram
— используй только допустимые теги: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="...">, <tg-spoiler>
— без пояснений
— без комментариев
— без обрамляющих кавычек
— без фразы "вот переписанный текст"
— не оборачивай всё в один тег"""

    user_prompt = f"Перепиши этот пост:\n\n{html_text}"

    try:
        response = await openai_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.75,
            max_tokens=2000,
        )
        result = response.choices[0].message.content
        if result:
            return result.strip()
        return None
    except Exception as e:
        log.error(f"OpenAI API error: {e}")
        return None


async def get_media_info(client: TelegramClient, message) -> tuple:
    """
    Returns (media_bytes, media_type, filename) or (None, None, None).
    media_type is one of: 'photo', 'video', 'animation', 'document'
    """
    if not message.media:
        return None, None, None

    try:
        if isinstance(message.media, MessageMediaPhoto):
            media_bytes = await client.download_media(message, file=bytes)
            return media_bytes, "photo", "photo.jpg"

        if isinstance(message.media, MessageMediaDocument):
            doc = message.media.document
            if doc.size > MAX_MEDIA_BYTES:
                log.info(f"Skipping media: too large ({doc.size // 1024 // 1024} MB)")
                return None, None, None

            filename = "file"
            is_video = False
            is_animation = False
            for attr in doc.attributes:
                attr_type = type(attr).__name__
                if attr_type == "DocumentAttributeFilename":
                    filename = attr.file_name
                if attr_type == "DocumentAttributeVideo":
                    is_video = True
                if attr_type == "DocumentAttributeAnimated":
                    is_animation = True

            media_bytes = await client.download_media(message, file=bytes)

            if is_animation:
                return media_bytes, "animation", filename or "animation.gif"
            if is_video:
                return media_bytes, "video", filename or "video.mp4"
            return media_bytes, "document", filename

    except Exception as e:
        log.error(f"Failed to download media: {e}")

    return None, None, None


MAX_CAPTION_LEN = 1024  # Telegram Bot API hard limit for media captions


async def send_via_bot(
    channel_name: str,
    rewritten: str,
    media_bytes: bytes | None = None,
    media_type: str | None = None,
    media_filename: str | None = None,
) -> None:
    source_line = f"Источник: {channel_name}"
    full_text = f"{source_line}\n\n{rewritten}"

    try:
        async with httpx.AsyncClient(timeout=120) as http:
            if media_bytes and media_type:
                # If caption would exceed Telegram's limit, send media + source only,
                # then send the full rewritten text as a separate message.
                if len(full_text) > MAX_CAPTION_LEN:
                    short_caption = source_line
                    await _send_media(http, media_bytes, media_type, media_filename, short_caption)
                    await asyncio.sleep(1)
                    await _send_text_only(full_text)
                else:
                    await _send_media(http, media_bytes, media_type, media_filename, full_text)
            else:
                resp = await http.post(
                    f"{BOT_API_URL}/sendMessage",
                    json={
                        "chat_id": TARGET_CHAT_ID,
                        "text": full_text,
                        "parse_mode": "HTML",
                    },
                )
                data = resp.json()
                if not data.get("ok"):
                    log.error(f"Bot API sendMessage error: {data}")
                    return

            log.info(f"✅ Sent rewritten post from {channel_name}" + (" + media" if media_bytes else ""))

    except Exception as e:
        log.error(f"Failed to send via bot API: {e}")


async def _send_media(
    http: httpx.AsyncClient,
    media_bytes: bytes,
    media_type: str,
    media_filename: str | None,
    caption: str,
) -> None:
    endpoint_map = {
        "photo": ("sendPhoto", "photo", media_filename or "photo.jpg"),
        "video": ("sendVideo", "video", media_filename or "video.mp4"),
        "animation": ("sendAnimation", "animation", media_filename or "animation.gif"),
        "document": ("sendDocument", "document", media_filename or "file"),
    }
    method, field, filename = endpoint_map.get(media_type, ("sendDocument", "document", media_filename or "file"))
    resp = await http.post(
        f"{BOT_API_URL}/{method}",
        data={"chat_id": TARGET_CHAT_ID, "caption": caption, "parse_mode": "HTML"},
        files={field: (filename, media_bytes)},
    )
    data = resp.json()
    if not data.get("ok"):
        log.error(f"Bot API {method} error: {data}")


async def _send_text_only(text: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                f"{BOT_API_URL}/sendMessage",
                json={
                    "chat_id": TARGET_CHAT_ID,
                    "text": text,
                    "parse_mode": "HTML",
                },
            )
            data = resp.json()
            if not data.get("ok"):
                log.error(f"Text-only fallback also failed: {data}")
            else:
                log.info("✅ Sent text-only fallback")
    except Exception as e:
        log.error(f"Text-only fallback error: {e}")


async def process_message(client: TelegramClient, channel: str, message) -> None:
    """Rewrite text, download media if present, send to target chat."""
    html_text = message_to_html(message)
    plain_text = message.message or ""

    has_text = len(plain_text.strip()) >= MIN_POST_LENGTH
    has_media = message.media is not None

    if not has_text and not has_media:
        return

    rewritten = None
    if has_text:
        rewritten = await rewrite_post(html_text, channel)

    media_bytes, media_type, media_filename = None, None, None
    if has_media:
        log.info(f"[{channel}] Downloading media for msg {message.id}...")
        media_bytes, media_type, media_filename = await get_media_info(client, message)

    if rewritten or media_bytes:
        text_to_send = rewritten or plain_text.strip()
        await send_via_bot(channel, text_to_send, media_bytes, media_type, media_filename)


async def check_channel(client: TelegramClient, state: dict, channel: str) -> None:
    channel_key = channel.lstrip("@").lower()
    last_id = state.get(channel_key, 0)

    try:
        messages = await client.get_messages(channel, limit=10)
    except Exception as e:
        log.error(f"[{channel}] Failed to fetch messages: {e}")
        return

    new_messages = [m for m in messages if m.id > last_id]
    if not new_messages:
        return

    new_messages.sort(key=lambda m: m.id)

    for message in new_messages:
        if not is_tracker_enabled():
            log.info(f"[{channel}] Tracker выключен mid-channel — прерываю.")
            break

        text = message.message or ""
        has_media = message.media is not None

        if len(text.strip()) < MIN_POST_LENGTH and not has_media:
            log.info(f"[{channel}] Skipping msg {message.id}: too short and no media")
            state[channel_key] = max(state.get(channel_key, 0), message.id)
            continue

        log.info(f"[{channel}] New post {message.id} ({len(text)} chars, media={has_media}) — processing...")
        await process_message(client, channel, message)

        state[channel_key] = max(state.get(channel_key, 0), message.id)
        save_state(state)
        await asyncio.sleep(2)


async def bootstrap(client: TelegramClient, state: dict) -> dict:
    log.info(f"Bootstrap: sending last {INITIAL_POSTS_PER_CHANNEL} posts from each channel...")
    for channel in SOURCE_CHANNELS:
        try:
            channel_key = channel.lstrip("@").lower()
            messages = await client.get_messages(channel, limit=INITIAL_POSTS_PER_CHANNEL)
            if not messages:
                state[channel_key] = 0
                continue

            to_process = sorted(messages, key=lambda m: m.id)

            for message in to_process:
                text = message.message or ""
                has_media = message.media is not None

                if len(text.strip()) < MIN_POST_LENGTH and not has_media:
                    log.info(f"[{channel}] Skipping initial msg {message.id}: too short and no media")
                    state[channel_key] = max(state.get(channel_key, 0), message.id)
                    continue

                log.info(f"[{channel}] Sending initial post {message.id} ({len(text)} chars, media={has_media})...")
                await process_message(client, channel, message)

                state[channel_key] = max(state.get(channel_key, 0), message.id)
                save_state(state)
                await asyncio.sleep(3)

        except Exception as e:
            log.error(f"  {channel}: bootstrap error: {e}")

    state = mark_bootstrap_done(state)
    save_state(state)
    log.info("Bootstrap done. Now monitoring for new posts...")
    return state


async def poll_loop(client: TelegramClient, state: dict) -> None:
    log.info(f"Polling every {POLL_INTERVAL}s for new posts in {len(SOURCE_CHANNELS)} channels...")
    while True:
        state = load_state()
        if not is_tracker_enabled(state):
            log.info("Tracker выключен (tracker_enabled=false). Ожидаю…")
            await asyncio.sleep(POLL_INTERVAL)
            continue
        if not is_bootstrap_done(state):
            state = await bootstrap(client, state)
        for channel in SOURCE_CHANNELS:
            state = load_state()
            if not is_tracker_enabled(state):
                break
            await check_channel(client, state, channel)
        await asyncio.sleep(POLL_INTERVAL)


async def main() -> None:
    log.info("Starting Telegram Rewriter Bot + Task Radar API...")
    log.info(f"Channels: {SOURCE_CHANNELS}")
    log.info(f"Target chat ID: {TARGET_CHAT_ID}")

    state = load_state()

    try:
        client = await telegram_runtime.start()
    except RuntimeError as exc:
        log.error("%s", exc)
        sys.exit(1)

    log.info("Telegram connected.")

    if is_tracker_enabled(state) and not is_bootstrap_done(state):
        state = await bootstrap(client, state)

    runner = await start_task_radar_api(telegram_runtime)
    try:
        await poll_loop(client, state)
    finally:
        await runner.cleanup()
        await telegram_runtime.shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Stopped.")
