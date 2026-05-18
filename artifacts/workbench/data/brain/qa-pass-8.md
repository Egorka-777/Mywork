# Pass 8 — QA Report (Hard QA / Smoke / Visual Check)

**Date:** 2026-05-18

---

## Issues Found and Fixed

### Fix 1 — Missing package install
**Problem:** `@anthropic-ai/sdk` was declared in `artifacts/workbench/package.json`
(`"^0.96.0"`) and was present in the root `pnpm-lock.yaml`, but was not physically
installed in `node_modules`. The API server crashed on startup with:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@anthropic-ai/sdk'
```
All `/wb/*` routes returned `ECONNREFUSED`.

**Fix:** `pnpm --filter @workspace/workbench add @anthropic-ai/sdk`
Package `@anthropic-ai/sdk@0.96.0` installed. API server started successfully.

---

### Fix 2 — Wrong env check order in agent message route
**File:** `artifacts/workbench/server/index.ts` — `POST /wb/agents/:key/messages`

**Problem:** `agent.modelEnv` (e.g. `ANTHROPIC_MODEL_CEO`) was checked before
`ANTHROPIC_API_KEY`. Result: the route returned `Missing required env: ANTHROPIC_MODEL_CEO`
instead of the required `Missing required env: ANTHROPIC_API_KEY`.

**Fix:** Moved `getAnthropicClient()` (which calls `getRequiredEnv("ANTHROPIC_API_KEY")`)
to run before the model-env lookup. Now the API key is validated first.

```diff
-    const model = process.env[agent.modelEnv]?.trim();
-    if (!model) { return res.status(500).json({ error: `Missing required env: ${agent.modelEnv}` }); }
-    const userMessage = await appendAgentMessage(...)
-    const client = getAnthropicClient();
+    const client = getAnthropicClient();   // checks ANTHROPIC_API_KEY first
+    const model = process.env[agent.modelEnv]?.trim();
+    if (!model) { return res.status(500).json({ error: `Missing required env: ${agent.modelEnv}` }); }
+    const userMessage = await appendAgentMessage(...)
```

---

## 18-Point Checklist Results

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 1 | `pnpm run typecheck` | ✅ PASS | 0 errors |
| 2 | `pnpm run build` | ✅ PASS | vite build, 273 kB JS, 45 kB CSS |
| 3 | `GET /wb/health` → 200 | ✅ PASS | `{"ok":true,"statePath":"...","keys":{...}}` |
| 4 | `GET /wb/brain/state` → JSON with goalYear/focusWeek | ✅ PASS | Both fields present |
| 5 | `GET /wb/agents` → list of 6 agents | ✅ PASS | ceo, operations, funnel, content_strategy, rewriter, tech_architect |
| 6 | `GET /wb/agents/ceo/messages` → array | ✅ PASS | `{"messages":[]}` |
| 7 | `GET /wb/brain/log?limit=5` → entries | ✅ PASS | `{"entries":[]}` before write |
| 8 | `POST /wb/brain/log` creates entry | ✅ PASS | Entry with uuid+ts returned |
| 9 | `GET /wb/brain/log?limit=5` shows entry | ✅ PASS | Entry visible after write |
| 10 | `data/brain/log.jsonl` has entry on disk | ✅ PASS | Line written and confirmed |
| 11 | `POST /wb/agents/ceo/messages` without env → `Missing required env: ANTHROPIC_API_KEY` | ✅ PASS | Returns `{"error":"Missing required env: ANTHROPIC_API_KEY"}` after Fix 2 |
| 12 | `data/brain/conversations/ceo.jsonl` not created (no successful reply) | ✅ PASS | File absent — correct |
| 13 | UI: Agents Hub tile is first | ✅ PASS | Top of page |
| 14 | UI: Shows focusWeek title | ✅ PASS | "Запустить Agents Hub in workbench" |
| 15 | UI: Shows daily task count | ✅ PASS | "3 всего · 0 готово" |
| 16 | UI: Shows agent count | ✅ PASS | "6" |
| 17 | UI: Panel open button visible | ✅ PASS | "Открыть рабочую панель" renders |
| 18 | UI: Old 4 tiles not broken | ✅ PASS | Telegram Tracker, Threads, Instagram Carousel Remix, Source Rewriter all present |

---

## Changed Files

| File | Change |
|------|--------|
| `artifacts/workbench/server/index.ts` | Moved `getAnthropicClient()` before model-env lookup in `POST /wb/agents/:key/messages` |
| Environment | `pnpm add @anthropic-ai/sdk` — installed missing package into node_modules |
