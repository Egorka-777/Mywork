import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import type OpenAI from "openai";
import type { Express } from "express";

const _require = createRequire(import.meta.url);

// ─── ffmpeg: extract audio from video buffer → MP3 buffer ──────────────────

async function videoToAudioBuffer(
  buf: Buffer,
  inputExt: string
): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `${uid}_in${inputExt}`);
  const outputPath = path.join(tmpDir, `${uid}_out.mp3`);

  await fs.writeFile(inputPath, buf);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vn",                // no video
      "-acodec", "libmp3lame",
      "-q:a", "4",          // VBR quality (smaller file, good enough for STT)
      "-ar", "16000",       // 16 kHz — optimal for Whisper
      "-ac", "1",           // mono
      outputPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });

  const audioBuf = await fs.readFile(outputPath);

  // clean up temp files (non-blocking)
  void fs.unlink(inputPath).catch(() => {});
  void fs.unlink(outputPath).catch(() => {});

  return audioBuf;
}
import type {
  ExtractedSource,
  ExtractedVisualDescription,
  RewriteSettings,
  RewrittenSource,
  SourceFileType,
} from "../src/sourceRewriterTypes";

export const SOURCE_REWRITER_ALLOWED_EXT = new Set([
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".pdf",
  ".pptx",
  ".txt",
  ".md",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

export const VISUAL_ANALYSIS_PROMPT = `Ты анализируешь изображение не для распознавания личности, а для повторения визуального стиля и понимания исходного материала.

Верни строго JSON. Без markdown. Без пояснений.

Опиши только видимые элементы.

Не определяй личность человека.
Не называй человека по имени, если имя не написано явно на изображении.
Не делай выводы о национальности, здоровье, доходе, характере, политических взглядах или личной жизни.
Если на изображении есть человек, описывай только:
- позу;
- одежду;
- аксессуары;
- реквизит;
- свет;
- фон;
- композицию;
- цветовую палитру;
- общий визуальный стиль.

Аксессуары и реквизит включают:
очки, кольца, часы, микрофон, телефон, ноутбук, чашку, документы, наушники, камеру, блокнот, украшения, сумку, предметы в руках.

JSON format:
{
  "type": "photo | screenshot | chart | graphic | ui | unknown",
  "visibleText": "",
  "visualDescription": "",
  "styleDescription": "",
  "clothing": "",
  "accessoriesAndProps": "",
  "lighting": "",
  "background": "",
  "composition": "",
  "colors": [],
  "recreationNotes": []
}`;

export const USER_STYLE_PROMPT = `Ты пишешь в стиле маркетолога-практика.

Стиль:
- живо
- просто
- человечески
- без академичности
- без инфоцыганства
- без GPT-воды
- без длинных заходов
- без стерильной экспертности
- без фраз "в современном мире", "важно понимать", "давайте разберёмся"
- короткие абзацы
- один абзац = одна мысль
- связные переходы
- конкретика
- примеры
- внутренние мысли
- честные наблюдения
- лёгкая ирония, если уместно
- без пафоса
- без умничанья

Текст должен звучать так, будто живой человек взял исходную мысль, пропустил через свой опыт и объяснил по-человечески.

Нельзя:
- копировать чужие формулировки
- делать синонимайзинг
- сохранять чужой тон
- делать школьный пересказ
- писать как методичка
- писать как корпоративный блог
- писать как GPT
- выдумывать факты`;

const REWRITE_JSON_SCHEMA_HINT = `ВЕРНИ СТРОГО JSON:
{
  "id": "",
  "fileName": "",
  "fileType": "video | audio | pdf | presentation | image | text | docx | unknown",
  "rewriteMode": "",
  "fullRewrittenText": "",
  "rewrittenPages": [
    {
      "pageNumber": 1,
      "rewrittenText": "",
      "visualAssets": []
    }
  ],
  "rewrittenSlides": [
    {
      "slideNumber": 1,
      "rewrittenText": "",
      "visualAssets": [],
      "layoutNotes": ""
    }
  ],
  "rewrittenTranscript": "",
  "notes": []
}`;

function buildRewritePrompt(
  settings: RewriteSettings,
  editedSourceJson: string
): string {
  return `Ты переписываешь исходный материал в стиле автора.

Это НЕ всегда пост.
Не превращай материал в пост, если rewriteMode не требует этого.

СТИЛЬ АВТОРА:
${USER_STYLE_PROMPT}

НАСТРОЙКИ:
rewriteMode: ${settings.rewriteMode}
outputLength: ${settings.outputLength}
styleIntensity: ${settings.styleIntensity}
plagiarismSafety: ${settings.plagiarismSafety}

ГЛАВНОЕ ПРАВИЛО:
Если rewriteMode = preserve_original_structure, сохрани исходную структуру, порядок, формат и примерный объём материала.

ПРАВИЛА:
- не копируй исходные формулировки;
- не делай синонимайзинг;
- не делай пересказ как школьное изложение;
- не пиши как GPT;
- не добавляй факты, которых нет в исходнике;
- не удаляй важные детали;
- не превращай в пост без команды;
- не сокращай без команды;
- сохраняй смысл;
- сохраняй порядок;
- сохраняй примерный объём, если outputLength = keep_similar_length;
- если исходник презентация, верни результат по слайдам;
- если исходник PDF, верни результат по страницам/секциям;
- если исходник видео/аудио, верни переписанный transcript/readable text;
- если в исходнике есть визуалы, сохрани их описания рядом с соответствующим блоком;
- текст должен звучать живо, естественно, без GPT-запаха.

ПРАВИЛА ОБЪЁМА:
- keep_similar_length: итоговый текст должен быть примерно 80–120% от объёма исходного текста;
- shorter: итоговый текст должен быть примерно 50–70% от исходного;
- longer: итоговый текст должен быть примерно 120–160% от исходного;
- very_concise: оставить только главное;
- expanded: расширить объяснения, не добавляя неподтверждённые факты.

ВХОДНЫЕ ДАННЫЕ:
${editedSourceJson}

${REWRITE_JSON_SCHEMA_HINT}`;
}

function normalizeLineBreaks(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseModelJson(rawText: string): unknown {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned) as unknown;
}

function coerceVisualType(
  v: unknown
): ExtractedVisualDescription["type"] {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (
    s === "photo" ||
    s === "screenshot" ||
    s === "chart" ||
    s === "graphic" ||
    s === "ui" ||
    s === "unknown"
  ) {
    return s;
  }
  return "unknown";
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function mapVisionJsonToAsset(
  raw: Record<string, unknown>,
  id: string
): ExtractedVisualDescription {
  return {
    id,
    type: coerceVisualType(raw.type),
    visibleText: typeof raw.visibleText === "string" ? raw.visibleText : "",
    visualDescription:
      typeof raw.visualDescription === "string" ? raw.visualDescription : "",
    styleDescription:
      typeof raw.styleDescription === "string" ? raw.styleDescription : "",
    clothing: typeof raw.clothing === "string" ? raw.clothing : "",
    accessoriesAndProps:
      typeof raw.accessoriesAndProps === "string"
        ? raw.accessoriesAndProps
        : "",
    lighting: typeof raw.lighting === "string" ? raw.lighting : "",
    background: typeof raw.background === "string" ? raw.background : "",
    composition: typeof raw.composition === "string" ? raw.composition : "",
    colors: coerceStringArray(raw.colors),
    recreationNotes: coerceStringArray(raw.recreationNotes),
  };
}

function extToFileType(ext: string): SourceFileType {
  switch (ext) {
    case ".mp4":
    case ".mov":
      return "video";
    case ".mp3":
    case ".wav":
      return "audio";
    case ".pdf":
      return "pdf";
    case ".pptx":
      return "presentation";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".webp":
      return "image";
    case ".txt":
    case ".md":
      return "text";
    case ".docx":
      return "docx";
    default:
      return "unknown";
  }
}

export function emptyExtractedBase(
  id: string,
  fileName: string,
  fileType: SourceFileType,
  warnings: string[]
): ExtractedSource {
  return {
    id,
    fileName,
    fileType,
    fullRawText: "",
    visualAssets: [],
    extractionWarnings: warnings,
  };
}

async function visionExtractImage(
  openrouter: OpenAI,
  visionModel: string,
  buffer: Buffer,
  mime: string
): Promise<ExtractedVisualDescription> {
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  const completion = await openrouter.chat.completions.create({
    model: visionModel,
    max_tokens: 2048,
    messages: [
      {
        role: "system",
        content:
          "You return only valid JSON per the user schema. No markdown. No explanations.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: VISUAL_ANALYSIS_PROMPT },
          {
            type: "image_url",
            image_url: { url: dataUrl },
          },
        ],
      },
    ],
  });
  const rawText = completion.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = parseModelJson(rawText);
  } catch {
    throw new Error(`VISION_JSON:${rawText.slice(0, 2000)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`VISION_JSON:${rawText.slice(0, 2000)}`);
  }
  const id = crypto.randomUUID();
  return mapVisionJsonToAsset(parsed as Record<string, unknown>, id);
}

// ─── Audio transcription via Groq Whisper ──────────────────────────────────

async function transcribeAudioGroq(
  groqApiKey: string,
  buf: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(buf)], { type: mimeType });
  formData.append("file", blob, fileName);
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "text");

  const response = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: formData,
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq transcription error ${response.status}: ${err}`);
  }

  const text = await response.text();
  return text.trim();
}

// ─── PDF extraction ─────────────────────────────────────────────────────────

async function extractPdf(buf: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const pdfParse = _require("pdf-parse") as (
    buf: Buffer
  ) => Promise<{ text: string }>;
  const data = await pdfParse(buf);
  return normalizeLineBreaks(data.text ?? "");
}

// ─── DOCX extraction ────────────────────────────────────────────────────────

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = _require("mammoth") as {
    extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ buffer: buf });
  return normalizeLineBreaks(result.value ?? "");
}

// ─── PPTX extraction ────────────────────────────────────────────────────────

type PptxSlide = { slideNumber: number; rawText: string; layoutNotes: string; visualAssets: ExtractedVisualDescription[] };

function extractPptx(buf: Buffer): { slides: PptxSlide[]; fullRawText: string } {
  const AdmZip = _require("adm-zip") as new (buf: Buffer) => {
    getEntries(): { entryName: string; getData(): Buffer }[];
  };
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();

  const slideEntries = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const na = parseInt(a.entryName.match(/\d+/)![0], 10);
      const nb = parseInt(b.entryName.match(/\d+/)![0], 10);
      return na - nb;
    });

  const slides: PptxSlide[] = slideEntries.map((entry, i) => {
    const xml = entry.getData().toString("utf-8");
    const textMatches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
    const texts = textMatches.map((t) => t.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    const rawText = texts.join(" ");
    return {
      slideNumber: i + 1,
      rawText,
      layoutNotes: "",
      visualAssets: [],
    };
  });

  const fullRawText = slides.map((s) => `Slide ${s.slideNumber}:\n${s.rawText}`).join("\n\n");
  return { slides, fullRawText };
}

// ─── Main extract function ──────────────────────────────────────────────────

export async function extractSourceFromUpload(
  openrouter: OpenAI,
  opts: {
    visionModel: string;
    hasOpenRouter: boolean;
    groqApiKey?: string;
  },
  file: Express.Multer.File
): Promise<ExtractedSource> {
  const id = crypto.randomUUID();
  const fileName = file.originalname || "upload";
  const ext = path.extname(fileName).toLowerCase();

  if (!SOURCE_REWRITER_ALLOWED_EXT.has(ext)) {
    throw new ExtractError(400, { error: "unsupported file type" });
  }

  const fileType = extToFileType(ext);
  const buf = file.buffer;

  // ── Plain text ────────────────────────────────────────────────────────────
  if (ext === ".txt" || ext === ".md") {
    const fullRawText = normalizeLineBreaks(buf.toString("utf-8"));
    return { id, fileName, fileType: "text", fullRawText, visualAssets: [], extractionWarnings: [] };
  }

  // ── Image (vision) ────────────────────────────────────────────────────────
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
    if (!opts.hasOpenRouter) {
      throw new ExtractError(503, { error: "OPENROUTER_API_KEY not configured" });
    }
    try {
      const mime =
        file.mimetype && file.mimetype !== "application/octet-stream"
          ? file.mimetype
          : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      const asset = await visionExtractImage(openrouter, opts.visionModel, buf, mime);
      return {
        id, fileName, fileType: "image",
        fullRawText: asset.visibleText,
        visualAssets: [asset],
        extractionWarnings: [],
      };
    } catch (e) {
      const msg = String(e);
      if (msg.startsWith("VISION_JSON:")) {
        const raw = msg.slice("VISION_JSON:".length);
        throw new ExtractError(500, { error: "extraction failed", detail: "Invalid model JSON response", raw: raw.slice(0, 2000) });
      }
      throw new ExtractError(500, { error: "extraction failed", detail: msg });
    }
  }

  // ── DOCX ─────────────────────────────────────────────────────────────────
  if (ext === ".docx") {
    try {
      const fullRawText = await extractDocx(buf);
      return { id, fileName, fileType: "docx", fullRawText, visualAssets: [], extractionWarnings: [] };
    } catch (e) {
      throw new ExtractError(500, { error: "DOCX extraction failed", detail: String(e) });
    }
  }

  // ── PDF ───────────────────────────────────────────────────────────────────
  if (ext === ".pdf") {
    try {
      const fullRawText = await extractPdf(buf);
      return { id, fileName, fileType: "pdf", fullRawText, visualAssets: [], extractionWarnings: [] };
    } catch (e) {
      throw new ExtractError(500, { error: "PDF extraction failed", detail: String(e) });
    }
  }

  // ── PPTX ──────────────────────────────────────────────────────────────────
  if (ext === ".pptx") {
    try {
      const { slides, fullRawText } = extractPptx(buf);
      return { id, fileName, fileType: "presentation", fullRawText, slides, visualAssets: [], extractionWarnings: [] };
    } catch (e) {
      throw new ExtractError(500, { error: "PPTX extraction failed", detail: String(e) });
    }
  }

  // ── Audio (MP3 / WAV) ─────────────────────────────────────────────────────
  if (ext === ".mp3" || ext === ".wav") {
    if (!opts.groqApiKey) {
      return emptyExtractedBase(id, fileName, "audio", ["GROQ_API_KEY not configured — audio transcription unavailable."]);
    }
    try {
      const mime = ext === ".wav" ? "audio/wav" : "audio/mpeg";
      const transcript = await transcribeAudioGroq(opts.groqApiKey, buf, fileName, mime);
      return {
        id, fileName, fileType: "audio",
        fullRawText: transcript,
        transcript,
        visualAssets: [],
        extractionWarnings: [],
      };
    } catch (e) {
      throw new ExtractError(500, { error: "Audio transcription failed", detail: String(e) });
    }
  }

  // ── Video (MP4 / MOV) — convert to audio via ffmpeg → Groq Whisper ────────
  if (ext === ".mp4" || ext === ".mov") {
    if (!opts.groqApiKey) {
      return emptyExtractedBase(id, fileName, "video", ["GROQ_API_KEY not configured — audio transcription unavailable."]);
    }
    try {
      const mp3Buf = await videoToAudioBuffer(buf, ext);
      const mp3Name = fileName.replace(/\.[^.]+$/, ".mp3");
      const transcript = await transcribeAudioGroq(opts.groqApiKey, mp3Buf, mp3Name, "audio/mpeg");
      return {
        id, fileName, fileType: "video",
        fullRawText: transcript,
        transcript,
        visualAssets: [],
        extractionWarnings: [],
      };
    } catch (e) {
      throw new ExtractError(500, { error: "Video transcription failed", detail: String(e) });
    }
  }

  return emptyExtractedBase(id, fileName, "unknown", ["unsupported file type"]);
}

export class ExtractError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>
  ) {
    super(JSON.stringify(body));
    this.name = "ExtractError";
  }
}

const CHUNK_SIZE = 12_000;
const CHUNK_OVERLAP = 500;
const PAYLOAD_SAFE = 28_000;

function chunkText(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

async function callRewriteModel(
  openrouter: OpenAI,
  textModel: string,
  userContent: string
): Promise<string> {
  const completion = await openrouter.chat.completions.create({
    model: textModel,
    max_tokens: 8192,
    messages: [
      {
        role: "system",
        content:
          "You follow instructions exactly. Return only valid JSON. No markdown fences.",
      },
      { role: "user", content: userContent },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}

function normalizeRewritten(
  parsed: Record<string, unknown>,
  edited: ExtractedSource,
  settings: RewriteSettings
): RewrittenSource {
  const fullRewrittenText =
    typeof parsed.fullRewrittenText === "string"
      ? parsed.fullRewrittenText
      : "";

  const rewriteMode = settings.rewriteMode;

  const notes = coerceStringArray(parsed.notes);

  const rp = parsed.rewrittenPages;
  const rs = parsed.rewrittenSlides;
  const rt = parsed.rewrittenTranscript;

  const rewrittenPages = Array.isArray(rp)
    ? rp
        .map((p) => {
          if (!p || typeof p !== "object") return null;
          const o = p as Record<string, unknown>;
          const pageNumber =
            typeof o.pageNumber === "number" ? o.pageNumber : NaN;
          const rewrittenText =
            typeof o.rewrittenText === "string" ? o.rewrittenText : "";
          const visualAssets = Array.isArray(o.visualAssets)
            ? (o.visualAssets as ExtractedVisualDescription[])
            : [];
          if (!Number.isFinite(pageNumber)) return null;
          return { pageNumber, rewrittenText, visualAssets };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    : undefined;

  const rewrittenSlides = Array.isArray(rs)
    ? rs
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const o = s as Record<string, unknown>;
          const slideNumber =
            typeof o.slideNumber === "number" ? o.slideNumber : NaN;
          const rewrittenText =
            typeof o.rewrittenText === "string" ? o.rewrittenText : "";
          const layoutNotes =
            typeof o.layoutNotes === "string" ? o.layoutNotes : "";
          const visualAssets = Array.isArray(o.visualAssets)
            ? (o.visualAssets as ExtractedVisualDescription[])
            : [];
          if (!Number.isFinite(slideNumber)) return null;
          return { slideNumber, rewrittenText, visualAssets, layoutNotes };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    : undefined;

  const rewrittenTranscript =
    typeof rt === "string" ? rt : undefined;

  return {
    id: typeof parsed.id === "string" ? parsed.id : edited.id,
    fileName:
      typeof parsed.fileName === "string" ? parsed.fileName : edited.fileName,
    fileType: edited.fileType,
    rewriteMode,
    fullRewrittenText,
    rewrittenPages,
    rewrittenSlides,
    rewrittenTranscript,
    notes,
  };
}

function validateRewritten(
  out: RewrittenSource,
  edited: ExtractedSource
): { ok: true } | { ok: false; raw: string } {
  if (typeof out.fullRewrittenText !== "string") {
    return { ok: false, raw: "missing fullRewrittenText" };
  }
  if (edited.pages?.length) {
    if (!Array.isArray(out.rewrittenPages)) {
      return { ok: false, raw: "rewrittenPages must be array when source has pages" };
    }
  }
  if (edited.slides?.length) {
    if (!Array.isArray(out.rewrittenSlides)) {
      return { ok: false, raw: "rewrittenSlides must be array when source has slides" };
    }
  }
  if (edited.transcript !== undefined && edited.transcript !== "") {
    const hasRt =
      typeof out.rewrittenTranscript === "string" &&
      out.rewrittenTranscript.length > 0;
    if (!hasRt && out.fullRewrittenText.length === 0) {
      return {
        ok: false,
        raw: "rewrittenTranscript or fullRewrittenText required when transcript present",
      };
    }
  }
  return { ok: true };
}

function buildChunkRewriteUserPrompt(
  settings: RewriteSettings,
  chunk: string,
  index: number,
  total: number
): string {
  return `Ты переписываешь фрагмент исходного материала в стиле автора. Это часть ${index} из ${total}; части склеиваются по порядку без пересказа.

СТИЛЬ АВТОРА:
${USER_STYLE_PROMPT}

НАСТРОЙКИ:
rewriteMode: ${settings.rewriteMode}
outputLength: ${settings.outputLength}
styleIntensity: ${settings.styleIntensity}
plagiarismSafety: ${settings.plagiarismSafety}

ПРАВИЛА: не добавляй факты; сохраняй смысл фрагмента; не делай вступления про номер части; пиши связный текст как продолжение документа.

ФРАГМЕНТ:
"""
${chunk}
"""

Верни строго JSON без markdown:
{"fullRewrittenText":""}`;
}

async function rewritePlainTextChunks(
  openrouter: OpenAI,
  textModel: string,
  settings: RewriteSettings,
  fullText: string,
  meta: { fileName: string; fileType: SourceFileType; id: string }
): Promise<RewrittenSource> {
  const chunks = chunkText(fullText, CHUNK_SIZE, CHUNK_OVERLAP);
  const parts: string[] = [];
  let i = 0;
  for (const chunk of chunks) {
    i += 1;
    const userContent = buildChunkRewriteUserPrompt(settings, chunk, i, chunks.length);
    const raw = await callRewriteModel(openrouter, textModel, userContent);
    let parsed: unknown;
    try {
      parsed = parseModelJson(raw);
    } catch {
      throw new RewriteError(502, {
        error: "Invalid model JSON response",
        raw: raw.slice(0, 2000),
      });
    }
    const o = parsed as Record<string, unknown>;
    const t =
      typeof o.fullRewrittenText === "string" ? o.fullRewrittenText : "";
    parts.push(t);
  }
  const merged = parts.join("\n\n");
  return {
    id: meta.id,
    fileName: meta.fileName,
    fileType: meta.fileType,
    rewriteMode: settings.rewriteMode,
    fullRewrittenText: merged,
    notes: [],
  };
}

export class RewriteError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>
  ) {
    super(JSON.stringify(body));
    this.name = "RewriteError";
  }
}

export async function rewriteSourceRequest(
  openrouter: OpenAI,
  textModel: string,
  body: unknown
): Promise<RewrittenSource> {
  if (!body || typeof body !== "object") {
    throw new RewriteError(400, { error: "Invalid body" });
  }
  const b = body as Record<string, unknown>;
  const extractedSource = b.extractedSource;
  const editedSource = b.editedSource;
  const settings = b.settings;

  if (!extractedSource || typeof extractedSource !== "object") {
    throw new RewriteError(400, { error: "extractedSource is required" });
  }
  if (!editedSource || typeof editedSource !== "object") {
    throw new RewriteError(400, { error: "editedSource is required" });
  }
  if (!settings || typeof settings !== "object") {
    throw new RewriteError(400, { error: "settings are required" });
  }

  const edited = editedSource as ExtractedSource;
  const rs = settings as RewriteSettings;

  const payload = JSON.stringify(edited);
  const textPayload = [
    edited.fullRawText,
    ...(edited.pages?.map((p) => p.rawText) ?? []),
    ...(edited.slides?.map((s) => s.rawText) ?? []),
    edited.transcript ?? "",
  ].join("\n\n");

  if (payload.length > PAYLOAD_SAFE && edited.slides?.length) {
    const rewrittenSlides: RewrittenSource["rewrittenSlides"] = [];
    for (const slide of edited.slides) {
      const mini = {
        ...edited,
        slides: [slide],
        pages: undefined,
        fullRawText: slide.rawText,
      };
      const userContent = buildRewritePrompt(rs, JSON.stringify(mini));
      const rawText = await callRewriteModel(openrouter, textModel, userContent);
      let parsed: unknown;
      try {
        parsed = parseModelJson(rawText);
      } catch {
        throw new RewriteError(502, {
          error: "Invalid model JSON response",
          raw: rawText.slice(0, 2000),
        });
      }
      const norm = normalizeRewritten(
        parsed as Record<string, unknown>,
        mini,
        rs
      );
      const first = norm.rewrittenSlides?.[0];
      if (first) {
        rewrittenSlides.push({
          slideNumber: slide.slideNumber,
          rewrittenText: first.rewrittenText,
          visualAssets: slide.visualAssets,
          layoutNotes: first.layoutNotes || slide.layoutNotes,
        });
      } else {
        rewrittenSlides.push({
          slideNumber: slide.slideNumber,
          rewrittenText: norm.fullRewrittenText,
          visualAssets: slide.visualAssets,
          layoutNotes: slide.layoutNotes,
        });
      }
    }
    const fullRewrittenText = rewrittenSlides
      .map((s) => s.rewrittenText)
      .join("\n\n");
    const out: RewrittenSource = {
      id: edited.id,
      fileName: edited.fileName,
      fileType: edited.fileType,
      rewriteMode: rs.rewriteMode,
      fullRewrittenText,
      rewrittenSlides,
      notes: [],
    };
    const v = validateRewritten(out, edited);
    if (!v.ok) {
      throw new RewriteError(502, {
        error: "Invalid model JSON response",
        raw: v.raw,
      });
    }
    return out;
  }

  if (payload.length > PAYLOAD_SAFE && edited.pages?.length) {
    const rewrittenPages: RewrittenSource["rewrittenPages"] = [];
    for (const page of edited.pages) {
      const mini = {
        ...edited,
        pages: [page],
        slides: undefined,
        fullRawText: page.rawText,
      };
      const userContent = buildRewritePrompt(rs, JSON.stringify(mini));
      const rawText = await callRewriteModel(openrouter, textModel, userContent);
      let parsed: unknown;
      try {
        parsed = parseModelJson(rawText);
      } catch {
        throw new RewriteError(502, {
          error: "Invalid model JSON response",
          raw: rawText.slice(0, 2000),
        });
      }
      const norm = normalizeRewritten(
        parsed as Record<string, unknown>,
        mini,
        rs
      );
      const first = norm.rewrittenPages?.[0];
      if (first) {
        rewrittenPages.push({
          pageNumber: page.pageNumber,
          rewrittenText: first.rewrittenText,
          visualAssets: page.visualAssets,
        });
      } else {
        rewrittenPages.push({
          pageNumber: page.pageNumber,
          rewrittenText: norm.fullRewrittenText,
          visualAssets: page.visualAssets,
        });
      }
    }
    const fullRewrittenText = rewrittenPages
      .map((p) => p.rewrittenText)
      .join("\n\n");
    const out: RewrittenSource = {
      id: edited.id,
      fileName: edited.fileName,
      fileType: edited.fileType,
      rewriteMode: rs.rewriteMode,
      fullRewrittenText,
      rewrittenPages,
      notes: [],
    };
    const v = validateRewritten(out, edited);
    if (!v.ok) {
      throw new RewriteError(502, {
        error: "Invalid model JSON response",
        raw: v.raw,
      });
    }
    return out;
  }

  if (payload.length > PAYLOAD_SAFE || textPayload.length > CHUNK_SIZE) {
    return rewritePlainTextChunks(openrouter, textModel, rs, edited.fullRawText, {
      id: edited.id,
      fileName: edited.fileName,
      fileType: edited.fileType,
    });
  }

  const userContent = buildRewritePrompt(rs, JSON.stringify(edited));
  const rawText = await callRewriteModel(openrouter, textModel, userContent);
  let parsed: unknown;
  try {
    parsed = parseModelJson(rawText);
  } catch {
    throw new RewriteError(502, {
      error: "Invalid model JSON response",
      raw: rawText.slice(0, 2000),
    });
  }
  const out = normalizeRewritten(
    parsed as Record<string, unknown>,
    edited,
    rs
  );
  const v = validateRewritten(out, edited);
  if (!v.ok) {
    throw new RewriteError(502, {
      error: "Invalid model JSON response",
      raw: v.raw,
    });
  }
  return out;
}
