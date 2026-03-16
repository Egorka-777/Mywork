import asyncio
import json
import logging
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv
from openai import AsyncOpenAI
from telethon import TelegramClient, events

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

TELEGRAM_API_ID = int(os.environ["TELEGRAM_API_ID"])
TELEGRAM_API_HASH = os.environ["TELEGRAM_API_HASH"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
BOT_TOKEN = os.environ["BOT_TOKEN"]
TARGET_CHAT_ID = os.environ["TARGET_CHAT_ID"]
SOURCE_CHANNELS_RAW = os.environ.get(
    "SOURCE_CHANNELS",
    "@kirillbezikov,@ungurenko_adout_digital,@artamonov_proreels,@blogoputiteyhana,@mirneyrosetey",
)
USER_STYLE = os.environ.get("USER_STYLE", "")

SOURCE_CHANNELS = [ch.strip() for ch in SOURCE_CHANNELS_RAW.split(",") if ch.strip()]

STATE_FILE = Path("state.json")
SESSION_FILE = "telethon_session"
MIN_POST_LENGTH = 100

BOT_API_URL = f"https://api.telegram.org/bot{BOT_TOKEN}"

openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)


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
    style_block = USER_STYLE if USER_STYLE else (
        "Маркетолог-практик 10+ лет. Спокойный. Короткий. По-человечески. Без пафоса. "
        "Без инфо-шума. Без умничанья. Простой понятный язык. Текст должен ощущаться живым. "
        "Каждая фраза должна цеплять и тянуть читать дальше. Каждое предложение должно работать как крючок. "
        "Текст должен быть плотным, интересным, затягивающим. Допустим лёгкий сторителлинг, если это усиливает пост. "
        "Тон наблюдательный, местами слегка ироничный. Ощущение, что пишет человек, который реально понимает, "
        "как устроены интернет, маркетинг, внимание, продажи и поведение людей. Без канцелярита. "
        "Без сухой экспертности. Без шаблонной мотивации. Без слишком вылизанного нейросеточного стиля."
    )

    system_prompt = f"""Ты опытный редактор и копирайтер.

Твоя задача — переписать пост из Telegram под стиль автора.

Стиль автора:
{style_block}

Правила переписывания:
- Сохраняй смысл, идею и общую механику оригинального поста.
- Не делай дословный рерайт.
- Не повторяй слишком близко фирменные фразы, словосочетания, ритм и структуру оригинала.
- Пиши так, чтобы не было ощущения плагиата.
- Если исходный пост сильный — просто перепиши его под стиль автора.
- Если исходный пост средний — улучши формулировки, плотность и читабельность, но не меняй основную мысль.
- Если в посте есть откровенно чужой фирменный стиль — убери узнаваемые элементы и замени на более нейтральные, живые и аутентичные.
- Если в конце есть CTA — можно оставить его по смыслу, но сделать более нативным и аккуратным.
- Тип поста должен остаться таким же: нативный пост остаётся нативным, короткий резкий — коротким резким, плотный сторителлинговый — плотным цельным текстом.

Формат ответа:
- Только чистый готовый пост.
- Без заголовков типа "ЗАГОЛОВОК", "ТЕКСТ", "ХУКИ", "CTA".
- Без объяснений того, что было изменено.
- Без комментариев от модели.
- Без кавычек вокруг всего результата.
- Результат должен выглядеть как живой готовый пост для Telegram."""

    user_prompt = f"Перепиши этот пост:\n\n{original_text}"

    try:
        response = await openai_client.chat.completions.create(
            model="gpt-4o",
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
                json={
                    "chat_id": TARGET_CHAT_ID,
                    "text": text,
                    "parse_mode": "HTML",
                },
            )
            data = resp.json()
            if not data.get("ok"):
                log.error(f"Bot API error: {data}")
            else:
                log.info(f"Sent rewritten post from {channel_name} to chat {TARGET_CHAT_ID}")
    except Exception as e:
        log.error(f"Failed to send via bot API: {e}")


async def process_message(state: dict, channel_username: str, message) -> None:
    msg_id = message.id
    text = message.text or message.message or ""

    if not text or len(text.strip()) < MIN_POST_LENGTH:
        log.info(f"[{channel_username}] Skipping message {msg_id}: too short ({len(text.strip())} chars)")
        return

    log.info(f"[{channel_username}] Processing message {msg_id} ({len(text)} chars)")

    channel_key = channel_username.lstrip("@").lower()
    last_id = state.get(channel_key, 0)

    if msg_id <= last_id:
        log.info(f"[{channel_username}] Message {msg_id} already processed (last_id={last_id}), skipping")
        return

    rewritten = await rewrite_post(text, channel_username)
    if not rewritten:
        log.warning(f"[{channel_username}] Rewrite returned nothing for message {msg_id}")
        return

    await send_via_bot(channel_username, rewritten)

    state[channel_key] = max(state.get(channel_key, 0), msg_id)
    save_state(state)


async def bootstrap(client: TelegramClient, state: dict) -> dict:
    log.info("Running bootstrap: recording latest message IDs for each channel...")
    for channel in SOURCE_CHANNELS:
        try:
            channel_key = channel.lstrip("@").lower()
            messages = await client.get_messages(channel, limit=1)
            if messages:
                latest_id = messages[0].id
                state[channel_key] = latest_id
                log.info(f"  {channel}: last message id = {latest_id}")
            else:
                state[channel_key] = 0
                log.info(f"  {channel}: no messages found, starting from 0")
        except Exception as e:
            log.error(f"  {channel}: bootstrap error: {e}")
    state = mark_bootstrap_done(state)
    save_state(state)
    log.info("Bootstrap complete. Future posts will be processed.")
    return state


async def main() -> None:
    log.info("Starting Telegram Rewriter Bot...")
    log.info(f"Source channels: {SOURCE_CHANNELS}")
    log.info(f"Target chat ID: {TARGET_CHAT_ID}")

    state = load_state()

    client = TelegramClient(SESSION_FILE, TELEGRAM_API_ID, TELEGRAM_API_HASH)
    await client.start()
    log.info("Telegram personal account connected.")

    if not is_bootstrap_done(state):
        state = await bootstrap(client, state)
    else:
        log.info("Bootstrap already done. Monitoring for new posts...")

    @client.on(events.NewMessage(chats=SOURCE_CHANNELS))
    async def handler(event):
        nonlocal state
        try:
            channel = event.chat
            if channel and hasattr(channel, "username") and channel.username:
                channel_id = f"@{channel.username}"
            elif channel and hasattr(channel, "title") and channel.title:
                channel_id = channel.title
            else:
                channel_id = str(event.chat_id)

            channel_key = channel_id.lstrip("@").lower()
            msg_id = event.message.id
            last_id = state.get(channel_key, 0)

            if msg_id <= last_id:
                return

            await process_message(state, channel_id, event.message)
        except Exception as e:
            log.error(f"Error in message handler: {e}", exc_info=True)

    log.info("Listening for new messages. Press Ctrl+C to stop.")
    await client.run_until_disconnected()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Stopped by user.")
