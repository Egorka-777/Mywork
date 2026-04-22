import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/wb/health", (_req, res) => {
  res.json({ ok: true, statePath: STATE_FILE });
});

app.get("/wb/tracker", async (_req, res) => {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    const data = JSON.parse(raw) as { tracker_enabled?: boolean };
    return res.json({ enabled: data.tracker_enabled !== false });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return res
        .status(404)
        .json({ error: "state.json not found. Check TELEGRAM_STATE_PATH or run the bot from telegram-rewriter/." });
    }
    return res.status(500).json({ error: String(e) });
  }
});

app.put("/wb/tracker", async (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "Body must be { \"enabled\": boolean }" });
  }
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    data.tracker_enabled = enabled;
    await fs.writeFile(STATE_FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
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

app.use(express.static(path.join(__dirname, "..", "dist")));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[workbench-api] http://127.0.0.1:${PORT}`);
  console.log(`[workbench-api] state: ${STATE_FILE}`);
  console.log(`[workbench-api] freedz: ${FREEDZ_FILE}`);
});
