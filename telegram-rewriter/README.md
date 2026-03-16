# Telegram Rewriter Bot

A Python background worker that monitors Telegram channels, rewrites posts using OpenAI GPT-4o in your personal style, and sends them to your private draft channel.

## How It Works

1. On first run: connects to your Telegram account, records the latest message IDs in each source channel (bootstrap), and does **not** forward any old posts.
2. On subsequent runs: monitors only **new** posts, rewrites them via OpenAI, and forwards the result to your target channel.

## Project Structure

```
telegram-rewriter/
├── telegram_rewrite_bot.py   # Main worker script
├── requirements.txt          # Python dependencies
├── Procfile                  # Railway worker definition
├── .env.example              # Environment variable template
├── telethon_session.session  # Created on first run (Telethon auth)
└── state.json                # Created on first run (tracks last message IDs)
```

## Setup

### 1. Get Telegram API credentials

Go to https://my.telegram.org/apps and create an application. Copy `api_id` and `api_hash`.

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

### 3. First run (local — for authentication)

Run the bot locally **once** to complete the Telethon session authentication:

```bash
pip install -r requirements.txt
python telegram_rewrite_bot.py
```

Telethon will ask for your phone number and the confirmation code sent to your Telegram account. After that, a `telethon_session.session` file is created.

### 4. Deploy to Railway

- Create a new Railway project and connect this directory.
- Add all environment variables from `.env.example` in the Railway dashboard.
- Upload `telethon_session.session` to Railway persistent storage or use Railway Volumes.
- Railway will use the `Procfile` to start the worker: `python telegram_rewrite_bot.py`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_API_ID` | Yes | From https://my.telegram.org/apps |
| `TELEGRAM_API_HASH` | Yes | From https://my.telegram.org/apps |
| `OPENAI_API_KEY` | Yes | Your OpenAI API key |
| `SOURCE_CHANNELS` | Yes | Comma-separated channel usernames, e.g. `@ch1,@ch2` |
| `TARGET_CHANNEL` | Yes | Your draft channel, e.g. `@my_drafts` |
| `USER_STYLE` | No | Custom writing style description |

## Notes

- Posts shorter than 100 characters are skipped automatically.
- If Telegram or OpenAI is temporarily unavailable, the bot logs the error and continues — it does not crash.
- `state.json` tracks the last processed message ID per channel to avoid reprocessing old posts.
- The session file (`telethon_session.session`) must be present for Railway deployment. Generate it locally first.
