"""Step 2: Confirm the code and print session string. Requires AUTH_CODE env var."""
import asyncio
import json
import os
import sys
from telethon import TelegramClient
from telethon.sessions import StringSession

API_ID = 27635270
API_HASH = "e2001023bf90a93aa5af6f2026373657"

CODE = os.environ.get("AUTH_CODE", "")
if not CODE:
    print("ERROR: Set AUTH_CODE environment variable first.")
    sys.exit(1)

with open("auth_state.json") as f:
    state = json.load(f)


async def main():
    client = TelegramClient(StringSession(state["session"]), API_ID, API_HASH)
    await client.connect()
    try:
        await client.sign_in(
            phone=state["phone"],
            code=CODE,
            phone_code_hash=state["phone_code_hash"],
        )
    except Exception as e:
        print(f"Sign in error: {e}")
        await client.disconnect()
        return

    session_string = client.session.save()
    await client.disconnect()

    print()
    print("=" * 60)
    print("SUCCESS! Your TELETHON_SESSION_STRING:")
    print("=" * 60)
    print(session_string)
    print("=" * 60)


asyncio.run(main())
