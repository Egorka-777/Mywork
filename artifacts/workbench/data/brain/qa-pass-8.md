# Pass 8 — QA Report (Hard QA / Smoke / Visual Check)

**Date:** 2026-05-18

---

## Root Issue Found and Fixed

**Problem:** `@anthropic-ai/sdk` was declared in `artifacts/workbench/package.json`
(`"^0.96.0"`) and was present in the root `pnpm-lock.yaml`, but was not physically
installed in `node_modules`. The API server crashed on startup:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@anthropic-ai/sdk'
  imported from /home/runner/workspace/artifacts/workbench/server/index.ts
```

All `/wb/*` routes returned `ECONNREFUSED`.

**Fix applied:** `pnpm --filter @workspace/workbench add @anthropic-ai/sdk`
Package `@anthropic-ai/sdk@0.96.0` installed. API server started successfully.

---

## 18-Point Checklist Results

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 1 | `pnpm run typecheck` | ✅ PASS | 0 errors |
| 2 | `pnpm run build` | ✅ PASS | vite build, 273 kB JS, 45 kB CSS |
| 3 | `GET /wb/health` → 200 | ✅ PASS | `{"ok":true,"statePath":"...","keys":{...}}` |
| 4 | `GET /wb/brain/state` → JSON w/ goalYear/focusWeek | ✅ PASS | Both fields present |
| 5 | `GET /wb/agents` → list of 6 agents | ✅ PASS | ceo, operations, funnel, content_strategy, rewriter, tech_architect |
| 6 | `GET /wb/agents/ceo/messages` → array | ✅ PASS | `{"messages":[]}` |
| 7 | `GET /wb/brain/log?limit=5` → entries | ✅ PASS | `{"entries":[]}` (before write) |
| 8 | `POST /wb/brain/log` creates entry | ✅ PASS | Entry with uuid+ts returned |
| 9 | `GET /wb/brain/log?limit=5` shows entry | ✅ PASS | Entry visible after write |
| 10 | `data/brain/log.jsonl` has entry | ✅ PASS | Line written to disk |
| 11 | `POST /wb/agents/ceo/messages` → JSON error (no env) | ✅ PASS | `{"error":"Missing required env: ANTHROPIC_MODEL_CEO"}` |
| 12 | `data/brain/conversations/ceo.jsonl` | ✅ PASS | Not created (no successful agent reply — correct) |
| 13 | UI: Agents Hub tile is first | ✅ PASS | Top of page in screenshot |
| 14 | UI: Shows focusWeek title | ✅ PASS | "Запустить Agents Hub in workbench" |
| 15 | UI: Shows daily task count | ✅ PASS | "3 всего · 0 готово" |
| 16 | UI: Shows agent count | ✅ PASS | "6" |
| 17 | UI: Panel open button visible | ✅ PASS | "Открыть рабочую панель" button renders |
| 18 | UI: Old 4 tiles not broken | ✅ PASS | Telegram Tracker, Threads, Instagram Carousel Remix, Source Rewriter all present |

---

## Files Changed

- **Environment:** `pnpm install` — `@anthropic-ai/sdk@0.96.0` installed into `node_modules`
  (already declared in `package.json` and `pnpm-lock.yaml`, physically missing)
- **No code changes** — all owner files are clean; no regressions observed
