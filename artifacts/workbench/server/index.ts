import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { fal } from "@fal-ai/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const workbenchRoot = path.resolve(__dirname, "..");
const DEFAULT_STATE = path.join(repoRoot, "telegram-rewriter", "state.json");
const STATE_FILE = process.env.TELEGRAM_STATE_PATH
  ? path.resolve(process.env.TELEGRAM_STATE_PATH)
  : DEFAULT_STATE;

const DEFAULT_FREEDZ = path.join(workbenchRoot, "freedz-pipeline.json");
const FREEDZ_FILE = process.env.FREEDZ_PIPELINE_PATH
  ? path.resolve(process.env.FREEDZ_PIPELINE_PATH)
  : DEFAULT_FREEDZ;

const PORT = Number(process.env.WORKBENCH_API_PORT) || 8788;

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const FAL_KEY = process.env.FAL_KEY || "";
const THREADS_TOKEN = process.env.THREADS_TOKEN || "";
const GEMINI_MODEL = "google/gemini-2.0-flash-lite-001";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_KEY,
});

if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "4mb" }));

app.get("/wb/health", (_req, res) => {
  res.json({
    ok: true,
    statePath: STATE_FILE,
    keys: {
      openrouter: !!OPENROUTER_KEY,
      fal: !!FAL_KEY,
      threads: !!THREADS_TOKEN,
    },
  });
});

app.get("/wb/tracker", async (_req, res) => {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    const data = JSON.parse(raw) as { tracker_enabled?: boolean };
    return res.json({ enabled: data.tracker_enabled !== false });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return res.status(404).json({
        error:
          "state.json not found. Check TELEGRAM_STATE_PATH or run the bot from telegram-rewriter/.",
      });
    }
    return res.status(500).json({ error: String(e) });
  }
});

app.put("/wb/tracker", async (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    return res
      .status(400)
      .json({ error: 'Body must be { "enabled": boolean }' });
  }
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    data.tracker_enabled = enabled;
    await fs.writeFile(
      STATE_FILE,
      JSON.stringify(data, null, 2) + "\n",
      "utf-8"
    );
    return res.json({ ok: true, enabled });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return res.status(404).json({ error: "state.json not found" });
    }
    return res.status(500).json({ error: String(e) });
  }
});

app.get("/wb/freedz", async (_req, res) => {
  try {
    const raw = await fs.readFile(FREEDZ_FILE, "utf-8");
    return res.type("json").send(raw);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return res.status(404).json({ error: "freedz-pipeline.json missing" });
    }
    return res.status(500).json({ error: String(e) });
  }
});

app.put("/wb/freedz", async (req, res) => {
  try {
    const body = req.body;
    const text = JSON.stringify(body, null, 2) + "\n";
    await fs.writeFile(FREEDZ_FILE, text, "utf-8");
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.get("/wb/pipeline/status", (_req, res) => {
  res.json({
    gemini: { model: GEMINI_MODEL, ready: !!OPENROUTER_KEY },
    fal: { ready: !!FAL_KEY },
    threads: { ready: !!THREADS_TOKEN },
  });
});

app.post("/wb/pipeline/rewrite", async (req, res) => {
  const { text, style } = req.body as { text?: string; style?: string };
  if (!text?.trim()) {
    return res.status(400).json({ error: "text is required" });
  }
  if (!OPENROUTER_KEY) {
    return res.status(503).json({ error: "OPENROUTER_API_KEY not configured" });
  }
  try {
    const systemPrompt = style
      ? `Перепиши текст в стиле: ${style}. Верни только готовый пост, без пояснений.`
      : "Перепиши текст как короткий пост для Threads: живо, лаконично, без воды. Верни только пост, без пояснений.";
    const completion = await openrouter.chat.completions.create({
      model: GEMINI_MODEL,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    });
    const rewritten = completion.choices[0]?.message?.content ?? text;
    return res.json({ ok: true, rewritten, model: GEMINI_MODEL });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.post("/wb/pipeline/image", async (req, res) => {
  const { prompt } = req.body as { prompt?: string };
  if (!prompt?.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }
  if (!FAL_KEY) {
    return res.status(503).json({ error: "FAL_KEY not configured" });
  }
  try {
    const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
      input: { prompt, num_images: 1 },
    });
    const images = (result.data as { images?: { url: string }[] }).images ?? [];
    const url = images[0]?.url ?? null;
    return res.json({ ok: true, url });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.post("/wb/pipeline/publish", async (req, res) => {
  const { text, imageUrl } = req.body as {
    text?: string;
    imageUrl?: string;
  };
  if (!text?.trim()) {
    return res.status(400).json({ error: "text is required" });
  }
  if (!THREADS_TOKEN) {
    return res
      .status(503)
      .json({ error: "THREADS_TOKEN not configured — добавьте завтра" });
  }
  try {
    const baseUrl = "https://graph.threads.net/v1.0";
    const meRes = await fetch(`${baseUrl}/me?fields=id&access_token=${THREADS_TOKEN}`);
    const me = (await meRes.json()) as { id?: string; error?: unknown };
    if (!me.id) {
      return res.status(500).json({ error: "Failed to get Threads user id", detail: me });
    }
    const userId = me.id;
    const containerBody: Record<string, string> = {
      text,
      access_token: THREADS_TOKEN,
    };
    if (imageUrl) {
      containerBody.media_type = "IMAGE";
      containerBody.image_url = imageUrl;
    } else {
      containerBody.media_type = "TEXT";
    }
    const createRes = await fetch(`${baseUrl}/${userId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(containerBody),
    });
    const created = (await createRes.json()) as { id?: string; error?: unknown };
    if (!created.id) {
      return res.status(500).json({ error: "Failed to create container", detail: created });
    }
    const publishRes = await fetch(`${baseUrl}/${userId}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: created.id, access_token: THREADS_TOKEN }),
    });
    const published = (await publishRes.json()) as { id?: string; error?: unknown };
    if (!published.id) {
      return res.status(500).json({ error: "Failed to publish", detail: published });
    }
    return res.json({ ok: true, threadId: published.id });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.use(express.static(path.join(__dirname, "..", "dist")));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[workbench-api] http://127.0.0.1:${PORT}`);
  console.log(`[workbench-api] state: ${STATE_FILE}`);
  console.log(`[workbench-api] freedz: ${FREEDZ_FILE}`);
  console.log(`[workbench-api] openrouter: ${!!OPENROUTER_KEY} | fal: ${!!FAL_KEY} | threads: ${!!THREADS_TOKEN}`);
});
