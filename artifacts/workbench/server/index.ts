import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { fal } from "@fal-ai/client";
import multer from "multer";

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

const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || "";
const TEXT_MODEL =
  process.env.OPENROUTER_TEXT_MODEL || "google/gemini-2.0-flash-lite-001";
const VISION_MODEL =
  process.env.OPENROUTER_VISION_MODEL || "google/gemini-2.0-flash-001";
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID || "";
const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_KEY,
});

if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error("Only image/jpeg, image/png and image/webp are supported"));
      return;
    }
    cb(null, true);
  },
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "4mb" }));

// ─── helpers ────────────────────────────────────────────────────────────────

function isInstagramPostUrl(value: string) {
  return /^https:\/\/(www\.)?instagram\.com\/([\w.]+\/)?(p|reel)\//.test(value);
}

function normalizeApifyActorId(actorId: string) {
  return actorId.includes("/") ? actorId.replace("/", "~") : actorId;
}

function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function collectImageUrls(item: Record<string, unknown>) {
  const urls: string[] = [];
  const pushUrl = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//.test(value)) {
      urls.push(value);
    }
  };
  pushUrl(item.displayUrl);
  pushUrl(item.imageUrl);
  if (Array.isArray(item.images)) item.images.forEach(pushUrl);
  const childPosts = item.childPosts;
  if (Array.isArray(childPosts)) {
    childPosts.forEach((child) => {
      if (child && typeof child === "object") {
        const c = child as Record<string, unknown>;
        pushUrl(c.displayUrl);
        pushUrl(c.imageUrl);
      }
    });
  }
  const carouselMedia = item.carouselMedia;
  if (Array.isArray(carouselMedia)) {
    carouselMedia.forEach((media) => {
      if (media && typeof media === "object") {
        const m = media as Record<string, unknown>;
        pushUrl(m.displayUrl);
        pushUrl(m.imageUrl);
      }
    });
  }
  return Array.from(new Set(urls));
}

async function imageUrlToDataUrl(imageUrl: string) {
  const r = await fetch(imageUrl);
  if (!r.ok) throw new Error(`Failed to fetch image: ${r.status}`);
  const contentType = r.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await r.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function fileToDataUrl(file: Express.Multer.File) {
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}

async function uploadBufferToFalUrl(buffer: Buffer, mimeType: string) {
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  return await fal.storage.upload(blob);
}

async function remoteImageToFalUrl(imageUrl: string) {
  const r = await fetch(imageUrl);
  if (!r.ok) throw new Error(`Failed to fetch image for fal: ${r.status}`);
  const mimeType = r.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await r.arrayBuffer());
  return uploadBufferToFalUrl(buffer, mimeType);
}

async function fileToFalUrl(file: Express.Multer.File) {
  return uploadBufferToFalUrl(file.buffer, file.mimetype);
}

// ─── image proxy ─────────────────────────────────────────────────────────────

app.get("/wb/proxy-image", async (req, res) => {
  const url = req.query.url as string | undefined;
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).send("Missing or invalid url param");
  }
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; bot/1.0)",
        "Referer": "https://www.instagram.com/",
      },
    });
    if (!r.ok) return res.status(r.status).send(`Upstream error: ${r.status}`);
    const contentType = r.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await r.arrayBuffer());
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=3600");
    return res.send(buffer);
  } catch (e) {
    return res.status(502).send(String(e));
  }
});

// ─── health ─────────────────────────────────────────────────────────────────

app.get("/wb/health", (_req, res) => {
  res.json({
    ok: true,
    statePath: STATE_FILE,
    keys: {
      openrouter: !!OPENROUTER_KEY,
      fal: !!FAL_KEY,
      threads: !!THREADS_TOKEN,
      apify: !!APIFY_TOKEN,
    },
  });
});

// ─── tracker ────────────────────────────────────────────────────────────────

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

// ─── freedz ─────────────────────────────────────────────────────────────────

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

// ─── pipeline (Threads) ─────────────────────────────────────────────────────

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
      input: { prompt, image_urls: [], num_images: 1 },
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

// ─── carousel: import ────────────────────────────────────────────────────────

app.post("/wb/carousel/import-instagram", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url?.trim()) {
    return res.status(400).json({ error: "url is required" });
  }
  if (!isInstagramPostUrl(url.trim())) {
    return res.status(400).json({ error: "Only Instagram post/reel URLs are supported" });
  }
  if (!APIFY_TOKEN) {
    return res.status(503).json({ error: "APIFY_TOKEN not configured" });
  }
  if (!APIFY_ACTOR_ID) {
    return res.status(503).json({ error: "APIFY_ACTOR_ID not configured" });
  }
  try {
    const actorId = normalizeApifyActorId(APIFY_ACTOR_ID);
    const apifyUrl =
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items` +
      `?format=json&clean=true&maxItems=20&timeout=120`;

    const input = {
      resultsType: "posts",
      directUrls: [url.trim()],
      resultsLimit: 1,
      searchType: "hashtag",
      searchLimit: 1,
      addParentData: false,
    };

    const apifyRes = await fetch(apifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${APIFY_TOKEN}`,
      },
      body: JSON.stringify(input),
    });

    if (!apifyRes.ok) {
      let apifyBody = "";
      try { apifyBody = await apifyRes.text(); } catch { /* ignore */ }
      return res.status(502).json({
        error: `Apify request failed: ${apifyRes.status} ${apifyRes.statusText}`,
        detail: apifyBody.slice(0, 500),
      });
    }

    const items = (await apifyRes.json()) as Record<string, unknown>[];
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(422).json({ error: "No carousel images found in provider response" });
    }

    const item = items[0];
    const caption = pickFirstString(item.caption, item.text, item.description);
    const imageUrls = collectImageUrls(item);

    if (imageUrls.length === 0) {
      return res.status(422).json({ error: "No carousel images found in provider response" });
    }

    const slides = imageUrls.map((imageUrl, i) => ({
      slideIndex: i + 1,
      imageUrl,
      type: "image" as const,
    }));

    return res.json({
      ok: true,
      sourceUrl: url.trim(),
      caption,
      slides,
      rawProvider: "apify",
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ─── carousel: analyze ───────────────────────────────────────────────────────

app.post(
  "/wb/carousel/analyze",
  (req, res, next) => {
    const ct = req.headers["content-type"] ?? "";
    if (ct.includes("multipart/form-data")) {
      upload.array("slides", 20)(req, res, next);
    } else {
      next();
    }
  },
  async (req, res) => {
    if (!OPENROUTER_KEY) {
      return res.status(503).json({ error: "OPENROUTER_API_KEY not configured" });
    }

    let caption = "";
    let dataUrls: string[] = [];

    const ct = req.headers["content-type"] ?? "";
    if (ct.includes("multipart/form-data")) {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "slides files are required" });
      }
      caption = (req.body as { caption?: string }).caption ?? "";
      dataUrls = files.map(fileToDataUrl);
    } else {
      const body = req.body as { caption?: string; imageUrls?: string[] };
      caption = body.caption ?? "";
      const urls = body.imageUrls ?? [];
      if (urls.length === 0) {
        return res.status(400).json({ error: "imageUrls is required" });
      }
      try {
        dataUrls = await Promise.all(urls.map(imageUrlToDataUrl));
      } catch (e) {
        return res.status(502).json({ error: `Failed to fetch slide images: ${String(e)}` });
      }
    }

    const prompt = `Analyze these Instagram carousel slides and the post caption.\n\nCaption:\n"""\n${caption}\n"""\n\nFor each slide return ALL of the following fields:\n- slideIndex: integer starting from 1\n- originalText: exact OCR text visible on the slide, empty string if no readable text\n- visualDescription: concise 1-2 sentence description of what is visually shown on the slide\n- hasFace: true if a person's face is visible\n- hasScreenshot: true if the slide contains a screenshot of an app, website, or UI\n- hasText: true if there is readable text on the slide\n- slideRole: one of "cover" (first slide / hook), "content" (informational slide), "cta" (last call-to-action slide), or "unknown"\n- mentionedPeople: array of real person names mentioned or shown (e.g. ["Elon Musk", "Sam Altman"])\n- mentionedBrands: array of brand/company names (e.g. ["Apple", "Tesla"])\n- mentionedTools: array of software tools, apps, AI tools (e.g. ["ChatGPT", "Figma", "Midjourney"])\n- mentionedPlatforms: array of platforms/networks/sites (e.g. ["Instagram", "YouTube", "GitHub"])\n- visualElements: array of specific visual elements present (e.g. ["bold headline", "numbered list", "portrait photo", "pie chart", "dark background", "slide number"])\n- screenshotDescription: if hasScreenshot is true, describe what the screenshot shows; otherwise empty string\n- promptVisualHints: array of 2-4 specific ChatGPT image generation hints for recreating this slide in a new design (e.g. ["Use editorial dark background with blue accent", "Place brand logo in top-right corner"])\n- preserveNotes: array of concrete elements that must not be changed if regenerated\n- generationPrompt: short neutral prompt for creating a new transformed slide with the same useful idea but not a copy\n\nReturn JSON with this exact shape:\n{\n  "slides": [\n    {\n      "slideIndex": 1,\n      "originalText": "",\n      "visualDescription": "",\n      "hasFace": false,\n      "hasScreenshot": false,\n      "hasText": false,\n      "slideRole": "content",\n      "mentionedPeople": [],\n      "mentionedBrands": [],\n      "mentionedTools": [],\n      "mentionedPlatforms": [],\n      "visualElements": [],\n      "screenshotDescription": "",\n      "promptVisualHints": [],\n      "preserveNotes": [],\n      "generationPrompt": ""\n    }\n  ],\n  "captionSummary": "",\n  "sourceContentAngle": ""\n}\n\nThe number of slides in JSON must equal the number of input images.\nDo not invent slides.\nDo not omit slides.\nReturn only valid JSON. No markdown. No explanations.`;

    try {
      const content: unknown[] = [
        { type: "text", text: prompt },
        ...dataUrls.map((url) => ({
          type: "image_url",
          image_url: { url },
        })),
      ];

      const completion = await openrouter.chat.completions.create({
        model: VISION_MODEL,
        max_tokens: 4000,
        messages: [
          {
            role: "system",
            content:
              "You analyze Instagram carousel slides for legal, transformative content remixing. Do not help copy the original post verbatim. Extract the useful structure, OCR text, visual elements, screenshots, faces, and preservation requirements. Return only valid JSON. No markdown. No explanations.",
          },
          {
            role: "user",
            content,
          } as Parameters<typeof openrouter.chat.completions.create>[0]["messages"][0],
        ],
      });

      const rawText = completion.choices[0]?.message?.content ?? "";
      let parsed: { slides?: unknown[] };
      try {
        const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        parsed = JSON.parse(cleaned) as { slides?: unknown[] };
      } catch {
        return res.status(502).json({ error: "Invalid model JSON response", raw: rawText.slice(0, 2000) });
      }

      if (!Array.isArray(parsed.slides) || parsed.slides.length !== dataUrls.length) {
        return res.status(502).json({
          error: "Invalid model JSON response",
          raw: rawText.slice(0, 2000),
        });
      }

      return res.json({ ok: true, slides: parsed.slides });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }
);

// ─── carousel: rewrite ───────────────────────────────────────────────────────

app.post("/wb/carousel/rewrite", async (req, res) => {
  if (!OPENROUTER_KEY) {
    return res.status(503).json({ error: "OPENROUTER_API_KEY not configured" });
  }
  const { caption, style, slides } = req.body as {
    caption?: string;
    style?: string;
    slides?: unknown[];
  };
  if (!Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: "slides array is required" });
  }

  const userPrompt = `Rewrite this carousel.\n\nUser style:\n"""\n${style ?? ""}\n"""\n\nOriginal caption:\n"""\n${caption ?? ""}\n"""\n\nSlides:\n${JSON.stringify(slides)}\n\nReturn JSON:\n{\n  "slides": [\n    {\n      "slideIndex": 1,\n      "rewrittenText": "",\n      "generationPrompt": ""\n    }\n  ],\n  "rewrittenCaption": ""\n}\n\nRules:\n- Same slide count.\n- Same slide order.\n- No plagiarism.\n- Keep useful meaning.\n- No generic GPT phrases.\n- Each rewrittenText must be short enough for an Instagram carousel slide.`;

  try {
    const completion = await openrouter.chat.completions.create({
      model: TEXT_MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "system",
          content:
            "You rewrite carousel slide text for a new original Instagram carousel. Do not copy phrases verbatim. Keep the same slide count. Keep the practical value. Make the text shorter, clearer, more useful, and more viral. Write in Russian. Style: direct, human, practical, no GPT tone. Return only valid JSON.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    const rawText = completion.choices[0]?.message?.content ?? "";
    let parsed: { slides?: { slideIndex: number; rewrittenText: string; generationPrompt: string }[]; rewrittenCaption?: string };
    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: "Invalid model JSON response", raw: rawText.slice(0, 2000) });
    }

    if (!Array.isArray(parsed.slides) || parsed.slides.length !== slides.length) {
      return res.status(502).json({ error: "Invalid model JSON response", raw: rawText.slice(0, 2000) });
    }

    const inputIndices = (slides as { slideIndex: number }[]).map((s) => s.slideIndex);
    const outputIndices = parsed.slides.map((s) => s.slideIndex);
    const orderMismatch = inputIndices.some((idx, pos) => outputIndices[pos] !== idx);
    if (orderMismatch) {
      return res.status(502).json({ error: "Invalid model JSON response: slideIndex order mismatch", raw: rawText.slice(0, 2000) });
    }

    return res.json({ ok: true, slides: parsed.slides, rewrittenCaption: parsed.rewrittenCaption ?? "" });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ─── carousel: generate ──────────────────────────────────────────────────────

app.post(
  "/wb/carousel/generate",
  upload.fields([{ name: "userPhoto", maxCount: 1 }, { name: "slideFiles", maxCount: 20 }]),
  async (req, res) => {
    if (!FAL_KEY) {
      return res.status(503).json({ error: "FAL_KEY not configured" });
    }

    const slidesJsonStr = (req.body as { slidesJson?: string }).slidesJson ?? "";
    if (!slidesJsonStr) {
      return res.status(400).json({ error: "slidesJson is required" });
    }

    let slides: {
      slideIndex: number;
      sourceImageUrl: string | null;
      rewrittenText: string;
      generationPrompt: string;
      hasFace: boolean;
      hasScreenshot: boolean;
    }[];
    try {
      slides = JSON.parse(slidesJsonStr);
    } catch {
      return res.status(400).json({ error: "slidesJson must be valid JSON" });
    }

    const filesMap = req.files as Record<string, Express.Multer.File[]> | undefined;
    const userPhotoFile = filesMap?.["userPhoto"]?.[0] ?? null;
    const slideFiles = filesMap?.["slideFiles"] ?? [];

    let userPhotoFalUrl: string | null = null;
    if (userPhotoFile) {
      try {
        userPhotoFalUrl = await fileToFalUrl(userPhotoFile);
      } catch (e) {
        return res.status(500).json({ error: `Failed to upload user photo: ${String(e)}` });
      }
    }

    const results: { slideIndex: number; generatedImageUrl: string | null; error: string | null }[] = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      try {
        const imageUrls: string[] = [];

        if (slide.sourceImageUrl) {
          const falUrl = await remoteImageToFalUrl(slide.sourceImageUrl);
          imageUrls.push(falUrl);
        } else if (slideFiles[i]) {
          const falUrl = await fileToFalUrl(slideFiles[i]);
          imageUrls.push(falUrl);
        }

        if (userPhotoFalUrl && slide.hasFace) {
          imageUrls.push(userPhotoFalUrl);
        }

        let prompt = `Create a new original Instagram carousel slide in 4:5 format.\n\nDo not copy the original design exactly.\nKeep the same useful idea and information structure.\n\nUse this rewritten slide text exactly:\n"""\n${slide.rewrittenText}\n"""\n\nVisual direction:\n${slide.generationPrompt}\n\nIf a screenshot or UI capture exists in the reference image:\npreserve it as a locked content area.\nDo not rewrite, hallucinate, or distort text inside the screenshot.\n\nIf a user photo is provided and the original slide contains a person:\nreplace the original person with the person from the user reference photo.\nPreserve realistic facial identity from the user reference.\nDo not change age, gender, or facial structure.\n\nReturn one clean social media carousel slide.\nNo watermark.\nNo fake UI text unless explicitly present in rewrittenText.`;

        if (slide.hasScreenshot) {
          prompt +=
            "\n\nThe screenshot area is critical.\nIf you cannot preserve it cleanly, keep the layout simpler and do not redraw tiny screenshot text.";
        }

        const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
          input: {
            prompt,
            image_urls: imageUrls,
            num_images: 1,
            aspect_ratio: "4:5",
            output_format: "png",
            resolution: "1K",
          },
        });

        const images = (result.data as { images?: { url: string }[] }).images ?? [];
        const url = images[0]?.url ?? null;
        results.push({ slideIndex: slide.slideIndex, generatedImageUrl: url, error: null });
      } catch (e) {
        results.push({ slideIndex: slide.slideIndex, generatedImageUrl: null, error: String(e) });
      }
    }

    return res.json({ ok: true, slides: results });
  }
);

// ─── carousel: upload-final-assets ───────────────────────────────────────────

app.post(
  "/wb/carousel/upload-final-assets",
  upload.array("finalSlides", 20),
  async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "finalSlides files are required" });
    }
    if (!FAL_KEY) {
      return res.status(503).json({ error: "FAL_KEY not configured — cannot upload to public storage" });
    }
    try {
      const urls = await Promise.all(
        files.map((f) => uploadBufferToFalUrl(f.buffer, f.mimetype))
      );
      return res.json({ ok: true, urls });
    } catch (e) {
      return res.status(500).json({ error: `Upload failed: ${String(e)}` });
    }
  }
);

// ─── carousel: publish-instagram ─────────────────────────────────────────────

app.post("/wb/carousel/publish-instagram", async (req, res) => {
  const { caption, imageUrls } = req.body as {
    caption?: string;
    imageUrls?: string[];
  };
  if (!caption?.trim()) {
    return res.status(400).json({ error: "caption is required" });
  }
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return res.status(400).json({ error: "imageUrls array is required" });
  }
  if (!INSTAGRAM_ACCOUNT_ID) {
    return res
      .status(503)
      .json({ error: "INSTAGRAM_ACCOUNT_ID not configured — добавьте переменную окружения" });
  }
  if (!INSTAGRAM_ACCESS_TOKEN) {
    return res
      .status(503)
      .json({ error: "INSTAGRAM_ACCESS_TOKEN not configured — добавьте переменную окружения" });
  }

  // Meta Graph API for Instagram content publishing uses graph.facebook.com
  const baseUrl = "https://graph.facebook.com/v21.0";
  const igUserId = INSTAGRAM_ACCOUNT_ID;
  const token = INSTAGRAM_ACCESS_TOKEN;

  // Helper: poll a media container until status is FINISHED (or error)
  async function pollContainerReady(
    containerId: string,
    maxAttempts = 20,
    intervalMs = 3000
  ): Promise<{ ready: boolean; statusCode?: string }> {
    for (let i = 0; i < maxAttempts; i++) {
      const r = await fetch(
        `${baseUrl}/${containerId}?fields=status_code&access_token=${token}`
      );
      const d = (await r.json()) as { status_code?: string };
      if (d.status_code === "FINISHED") return { ready: true, statusCode: d.status_code };
      if (d.status_code === "ERROR" || d.status_code === "EXPIRED") {
        return { ready: false, statusCode: d.status_code };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return { ready: false, statusCode: "TIMEOUT" };
  }

  try {
    // Step 1: create a media container for each carousel image (form-encoded per Meta spec)
    const itemIds: string[] = [];
    for (const imageUrl of imageUrls) {
      const itemParams = new URLSearchParams({
        image_url: imageUrl,
        is_carousel_item: "true",
        access_token: token,
      });
      const itemRes = await fetch(`${baseUrl}/${igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: itemParams.toString(),
      });
      const itemData = (await itemRes.json()) as { id?: string; error?: { message?: string } };
      if (!itemData.id) {
        return res.status(502).json({
          error: `Failed to create carousel item for ${imageUrl}`,
          detail: itemData.error?.message ?? itemData,
        });
      }
      // Poll item container until FINISHED
      const itemReady = await pollContainerReady(itemData.id);
      if (!itemReady.ready) {
        return res.status(502).json({
          error: `Carousel item container not ready: ${itemReady.statusCode}`,
          containerId: itemData.id,
        });
      }
      itemIds.push(itemData.id);
    }

    // Step 2: create carousel container (form-encoded)
    const carouselParams = new URLSearchParams({
      media_type: "CAROUSEL",
      children: itemIds.join(","),
      caption: caption.trim(),
      access_token: token,
    });
    const carouselRes = await fetch(`${baseUrl}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: carouselParams.toString(),
    });
    const carouselData = (await carouselRes.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!carouselData.id) {
      return res.status(502).json({
        error: "Failed to create carousel container",
        detail: carouselData.error?.message ?? carouselData,
      });
    }

    // Poll carousel container until FINISHED
    const carouselReady = await pollContainerReady(carouselData.id);
    if (!carouselReady.ready) {
      return res.status(502).json({
        error: `Carousel container not ready: ${carouselReady.statusCode}`,
        containerId: carouselData.id,
      });
    }

    // Step 3: publish (form-encoded)
    const publishParams = new URLSearchParams({
      creation_id: carouselData.id,
      access_token: token,
    });
    const publishRes = await fetch(`${baseUrl}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: publishParams.toString(),
    });
    const publishData = (await publishRes.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!publishData.id) {
      return res.status(502).json({
        error: "Failed to publish carousel",
        detail: publishData.error?.message ?? publishData,
      });
    }

    // Fetch permalink (non-critical)
    let permalink: string | null = null;
    try {
      const infoRes = await fetch(
        `${baseUrl}/${publishData.id}?fields=permalink&access_token=${encodeURIComponent(token)}`
      );
      const infoData = (await infoRes.json()) as { permalink?: string };
      permalink = infoData.permalink ?? null;
    } catch {
      // non-critical
    }

    return res.json({
      ok: true,
      publishId: publishData.id,
      status: "published",
      permalink,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ─── static ──────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, "..", "dist")));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[workbench-api] http://127.0.0.1:${PORT}`);
  console.log(`[workbench-api] state: ${STATE_FILE}`);
  console.log(`[workbench-api] freedz: ${FREEDZ_FILE}`);
  console.log(`[workbench-api] openrouter: ${!!OPENROUTER_KEY} | fal: ${!!FAL_KEY} | threads: ${!!THREADS_TOKEN} | apify: ${!!APIFY_TOKEN}`);
});
