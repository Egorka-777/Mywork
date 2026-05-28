import cors from "cors";
import express from "express";
import {
  filterRecentPosts,
  readInstagramCompetitors,
  readInstagramRadarPosts,
  saveInstagramCompetitors,
  syncInstagramRadar,
} from "./instagramRadar";

const PORT = Number(process.env.INSTAGRAM_RADAR_API_PORT) || 8789;
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || "";

function parseWindowDays(value: unknown): 1 | 2 | 3 {
  const n = Number(value ?? 3);
  if (n === 1 || n === 2 || n === 3) return n;
  return 3;
}

function parseLimit(value: unknown): number {
  const n = Number(value ?? 30);
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(Math.floor(n), 100);
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/wb/instagram-radar/competitors", async (_req, res) => {
  try {
    const competitors = await readInstagramCompetitors();
    return res.json({ competitors });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.put("/wb/instagram-radar/competitors", async (req, res) => {
  try {
    const { urls } = req.body as { urls?: unknown };
    if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string")) {
      return res.status(400).json({ error: "Body must be { urls: string[] }" });
    }
    const competitors = await saveInstagramCompetitors(urls);
    return res.json({ competitors });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/wb/instagram-radar/sync", async (req, res) => {
  try {
    const windowDays = parseWindowDays((req.body as { windowDays?: unknown }).windowDays);
    const result = await syncInstagramRadar({
      windowDays,
      apifyToken: APIFY_TOKEN,
      apifyActorId: APIFY_ACTOR_ID,
    });
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/wb/instagram-radar/posts", async (req, res) => {
  try {
    const windowDays = parseWindowDays(req.query.windowDays);
    const limit = parseLimit(req.query.limit);
    const posts = filterRecentPosts(await readInstagramRadarPosts(), windowDays, limit);
    return res.json({ posts });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Instagram Radar API: http://127.0.0.1:${PORT}`);
});
