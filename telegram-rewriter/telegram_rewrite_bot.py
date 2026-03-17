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
from telethon.sessions import StringSession

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

TELEGRAM_API_ID = int(os.environ["TELEGRAM_API_ID"])
TELEGRAM_API_HASH = os.environ["TELEGRAM_API_HASH"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
BOT_TOKEN = os.environ["BOT_TOKEN"]
TARGET_CHAT_ID = os.environ["TARGET_CHAT_ID"]
TELETHON_SESSION_STRING = os.environ.get("TELETHON_SESSION_STRING", "")
SOURCE_CHANNELS_RAW = os.environ.get(
    "SOURCE_CHANNELS",
    "@kirillbezikov,@ungurenko_adout_digital,@artamonov_proreels,@blogoputiteyhana,@mirneyrosetey,"
    "@zolootykh,@ai_innovate_agency,@artem_kotelnikovv,@pasha_production1,@ReelsAcademyPotapovfx,"
    "@Evdo_kimova,@sadekovsasha,@saveliylenivin,@anjela_p,@reelsarkazi,@big_bad_coach,"
    "@maksim_and_ai,@belyakAi",
)
USER_STYLE = os.environ.get("USER_STYLE", "")

SOURCE_CHANNELS = [ch.strip() for ch in SOURCE_CHANNELS_RAW.split(",") if ch.strip()]

STATE_FILE = Path("state.json")
MIN_POST_LENGTH = 100
POLL_INTERVAL = 60  # seconds between checks
INITIAL_POSTS_PER_CHANNEL = 3  # how many recent posts to send on first launch

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
        STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        log.error(f"Could not save state.json: {e}")


def is_bootstrap_done(state: dict) -> bool:
    return state.get("__bootstrapped__", False)


def mark_bootstrap_done(state: dict) -> dict:
    state["__bootstrapped__"] = True
    return state


async def rewrite_post(original_text: str, channel_title: str) -> str | None:
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

Формат ответа:

— только готовый переписанный пост
— без пояснений
— без комментариев
— без кавычек
— без фразы "вот переписанный текст\""""

    user_prompt = f"Перепиши этот пост:\n\n{original_text}"

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


async def send_via_bot(channel_name: str, rewritten: str) -> None:
    text = f"Источник: {channel_name}\n\n{rewritten}"
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                f"{BOT_API_URL}/sendMessage",
                json={"chat_id": TARGET_CHAT_ID, "text": text},
            )
            data = resp.json()
            if not data.get("ok"):
                log.error(f"Bot API error sending to {TARGET_CHAT_ID}: {data}")
            else:
                log.info(f"✅ Sent rewritten post from {channel_name}")
    except Exception as e:
        log.error(f"Failed to send via bot API: {e}")


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

    # Process oldest first
    new_messages.sort(key=lambda m: m.id)

    for message in new_messages:
        text = message.text or message.message or ""
        if not text or len(text.strip()) < MIN_POST_LENGTH:
            log.info(f"[{channel}] Skipping msg {message.id}: too short ({len(text.strip())} chars)")
            state[channel_key] = max(state.get(channel_key, 0), message.id)
            continue

        log.info(f"[{channel}] New post {message.id} ({len(text)} chars) — rewriting...")
        rewritten = await rewrite_post(text, channel)
        if rewritten:
            await send_via_bot(channel, rewritten)
        else:
            log.warning(f"[{channel}] Rewrite returned nothing for msg {message.id}")

        state[channel_key] = max(state.get(channel_key, 0), message.id)
        save_state(state)

        # Small pause between posts to avoid rate limits
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

            # Process oldest first
            to_process = sorted(messages, key=lambda m: m.id)

            for message in to_process:
                text = message.text or message.message or ""
                if not text or len(text.strip()) < MIN_POST_LENGTH:
                    log.info(f"[{channel}] Skipping initial msg {message.id}: too short")
                    state[channel_key] = max(state.get(channel_key, 0), message.id)
                    continue

                log.info(f"[{channel}] Sending initial post {message.id} ({len(text)} chars)...")
                rewritten = await rewrite_post(text, channel)
                if rewritten:
                    await send_via_bot(channel, rewritten)
                else:
                    log.warning(f"[{channel}] Rewrite failed for initial post {message.id}")

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
        for channel in SOURCE_CHANNELS:
            await check_channel(client, state, channel)
        await asyncio.sleep(POLL_INTERVAL)


async def main() -> None:
    if not TELETHON_SESSION_STRING:
        log.error("TELETHON_SESSION_STRING is not set. Run generate_session.py first.")
        sys.exit(1)

    log.info("Starting Telegram Rewriter Bot...")
    log.info(f"Channels: {SOURCE_CHANNELS}")
    log.info(f"Target chat ID: {TARGET_CHAT_ID}")

    state = load_state()

    client = TelegramClient(StringSession(TELETHON_SESSION_STRING), TELEGRAM_API_ID, TELEGRAM_API_HASH)
    await client.start()
    log.info("Telegram connected.")

    if not is_bootstrap_done(state):
        state = await bootstrap(client, state)

    await poll_loop(client, state)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Stopped.")
