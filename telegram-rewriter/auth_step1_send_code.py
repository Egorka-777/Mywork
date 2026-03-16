"""Step 1: Send auth code to phone. Run once, saves phone_code_hash to auth_state.json"""
import asyncio
import json
from telethon import TelegramClient
from telethon.sessions import StringSession

API_ID = 27635270
API_HASH = "e2001023bf90a93aa5af6f2026373657"
PHONE = "+79135112404"


async def main():
    client = TelegramClient(StringSession(), API_ID, API_HASH)
    await client.connect()
    result = await client.send_code_request(PHONE)
    state = {
        "phone": PHONE,
        "phone_code_hash": result.phone_code_hash,
        "session": client.session.save(),
    }
    with open("auth_state.json", "w") as f:
        json.dump(state, f)
    await client.disconnect()
    print(f"Code sent to {PHONE}. Check Telegram and provide the code.")


asyncio.run(main())
