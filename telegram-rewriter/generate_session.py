"""
Run this script ONCE on your local machine to generate the Telethon session string.
Then add the output as the TELETHON_SESSION_STRING secret in Railway / Replit.

Usage:
    pip install telethon python-dotenv
    python generate_session.py
"""
import asyncio
import os
from telethon import TelegramClient
from telethon.sessions import StringSession
from dotenv import load_dotenv

load_dotenv()

API_ID = int(os.environ.get("TELEGRAM_API_ID", input("Enter TELEGRAM_API_ID: ")))
API_HASH = os.environ.get("TELEGRAM_API_HASH") or input("Enter TELEGRAM_API_HASH: ")


async def main():
    print()
    print("Connecting to Telegram...")
    print("You will receive a code in your Telegram app.")
    print()
    client = TelegramClient(StringSession(), API_ID, API_HASH)
    await client.start()
    session_string = client.session.save()
    await client.disconnect()
    print()
    print("=" * 60)
    print("SUCCESS! Add this as TELETHON_SESSION_STRING secret:")
    print("=" * 60)
    print(session_string)
    print("=" * 60)


asyncio.run(main())
