"""
Run this script ONCE to generate the Telethon session string.
Then add the output as the TELETHON_SESSION_STRING secret.
"""
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession

API_ID = 27635270
API_HASH = "e2001023bf90a93aa5af6f2026373657"


async def main():
    print()
    print("Подключаюсь к Telegram...")
    print("Сейчас придёт код в приложение Telegram.")
    print()
    client = TelegramClient(StringSession(), API_ID, API_HASH)
    await client.start()
    session_string = client.session.save()
    await client.disconnect()
    print()
    print("=" * 60)
    print("ГОТОВО! Добавьте это как секрет TELETHON_SESSION_STRING:")
    print("=" * 60)
    print(session_string)
    print("=" * 60)


asyncio.run(main())
