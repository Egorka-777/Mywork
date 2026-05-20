import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import type OpenAI from "openai";
import type { Express } from "express";
import type {
  CarouselPageRole,
  ExtractedSource,
  ExtractedVisualDescription,
  RewriteSettings,
  RewrittenCarouselPage,
  RewrittenSource,
  SourceFileType,
} from "../src/sourceRewriterTypes";

const _require = createRequire(import.meta.url);

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

const CAROUSEL_JSON_SCHEMA_HINT = `ВЕРНИ СТРОГО JSON:
{
  "id": "",
  "fileName": "",
  "fileType": "video | audio | pdf | presentation | image | text | docx | unknown",
  "rewriteMode": "carousel_script",
  "fullRewrittenText": "",
  "rewrittenCarouselPages": [
    {
      "pageNumber": 1,
      "role": "hook | content | cta",
      "rewrittenText": "",
      "visualPrompt": "",
      "notes": []
    }
  ],
  "rewrittenCaption": "",
  "carouselPromptPack": "",
  "notes": []
}`;

async function videoToAudioBuffer(buf: Buffer, inputExt: string): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `${uid}_in${inputExt}`);
  const outputPath = path.join(tmpDir, `${uid}_out.mp3`);

  await fs.writeFile(inputPath, buf);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "4",
      "-ar",
      "16000",
      "-ac",
      "1",
      outputPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });

  const audioBuf = await fs.readFile(outputPath);
  void fs.unlink(inputPath).catch(() => {});
  void fs.unlink(outputPath).catch(() => {});
  return audioBuf;
}

function buildRewritePrompt(settings: RewriteSettings, editedSourceJson: string): string {
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

function buildCarouselRewritePrompt(settings: RewriteSettings, edited: ExtractedSource): string {
  const slideCount = Math.min(Math.max(Number(settings.carouselSlideCount) || 6, 3), 10);
  const maxChars = Math.min(Math.max(Number(settings.carouselMaxCharsPerSlide) || 140, 60), 260);
  const styleNotes = settings.carouselStyleNotes?.trim() || "";
  const ctaText = settings.carouselCtaText?.trim() || "Сохрани этот пост и отправь тому, кому это пригодится.";

  return `Ты превращаешь исходный материал в сценарий Instagram-карусели.

СТИЛЬ АВТОРА:
${USER_STYLE_PROMPT}

ЖЁСТКИЙ ФОРМАТ КАРУСЕЛИ:
- Сделай ровно ${slideCount} страниц.
- Страница 1 всегда role = hook.
- Последняя страница всегда role = cta.
- Все страницы между ними всегда role = content.
- На странице 1 должен быть короткий, жёсткий, цепляющий hook с очевидной пользой для читателя.
- На странице 1 запрещён длинный абзац. Максимум ${Math.min(maxChars, 110)} символов.
- На content-страницах раскрывай пользу по шагам, без воды и без длинных полотен текста.
- На каждой странице максимум ${maxChars} символов.
- CTA должен быть простым действием: сохранить, переслать, написать слово в комментарии или забрать инструкцию.
- Не добавляй факты, которых нет в исходнике.
- Не оставляй школьный пересказ.
- Не пиши как методичка.
- Не пиши фразы "важно понимать", "в современном мире", "давайте разберёмся".
- Не копируй исходные формулировки.
- Сохраняй смысл, цифры, названия сервисов и последовательность полезной мысли.
- Если исходник спорный или описывает обход оплаты/регионов, не добавляй юридических гарантий и не обещай, что способ всегда сработает.

НАСТРОЙКИ:
rewriteMode: carousel_script
outputLength: ${settings.outputLength}
styleIntensity: ${settings.styleIntensity}
plagiarismSafety: ${settings.plagiarismSafety}
carouselSlideCount: ${slideCount}
carouselMaxCharsPerSlide: ${maxChars}
carouselCtaText: ${ctaText}
carouselStyleNotes: ${styleNotes || "нет"}

ТРЕБОВАНИЯ К visualPrompt ДЛЯ КАЖДОЙ СТРАНИЦЫ:
- Пиши конкретно, что должно быть на слайде визуально.
- Если упомянуты сервисы/бренды/нейросети/платформы, укажи логотипы или узнаваемые иконки.
- Не проси перерисовывать мелкий нечитаемый текст.
- Не выдумывай лица и личности.

ТРЕБОВАНИЯ К carouselPromptPack:
Собери готовый промпт для ChatGPT, который создаст ${slideCount} слайдов карусели по rewrittenCarouselPages.
Промпт должен включать:
- формат 4:5;
- единый стиль;
- правило: текст слайдов использовать точно;
- правило: не добавлять лишние факты;
- все rewrittenText и visualPrompt по страницам;
- стиль/референсы учитывать из carouselStyleNotes, если они есть.

ИСХОДНЫЕ ДАННЫЕ:
${JSON.stringify(edited)}

${CAROUSEL_JSON_SCHEMA_HINT}`;
}

function normalizeLineBreaks(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseModelJson(rawText: string): unknown {
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned) as unknown;
}

function coerceVisualType(v: unknown): ExtractedVisualDescription["type"] {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s === "photo" || s === "screenshot" || s === "chart" || s === "graphic" || s === "ui" || s === "unknown") return s;
  return "unknown";
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function coerceCarouselRole(v: unknown, pageNumber: number, total: number): CarouselPageRole {
  if (v === "hook" || v === "content" || v === "cta") return v;
  if (pageNumber === 1) return "hook";
  if (pageNumber === total) return "cta";
  return "content";
}

function mapVisionJsonToAsset(raw: Record<string, unknown>, id: string): ExtractedVisualDescription {
  return {
    id,
    type: coerceVisualType(raw.type),
    visibleText: typeof raw.visibleText === "string" ? raw.visibleText : "",
    visualDescription: typeof raw.visualDescription === "string" ? raw.visualDescription : "",
    styleDescription: typeof raw.styleDescription === "string" ? raw.styleDescription : "",
    clothing: typeof raw.clothing === "string" ? raw.clothing : "",
    accessoriesAndProps: typeof raw.accessoriesAndProps === "string" ? raw.accessoriesAndProps : "",
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

export function emptyExtractedBase(id: string, fileName: string, fileType: SourceFileType, warnings: string[]): ExtractedSource {
  return { id, fileName, fileType, fullRawText: "", visualAssets: [], extractionWarnings: warnings };
}

async function visionExtractImage(openrouter: OpenAI, visionModel: string, buffer: Buffer, mime: string): Promise<ExtractedVisualDescription> {
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  const completion = await openrouter.chat.completions.create({
    model: visionModel,
    max_tokens: 2048,
    messages: [
      { role: "system", content: "You return only valid JSON per the user schema. No markdown. No explanations." },
      {
        role: "user",
        content: [
          { type: "text", text: VISUAL_ANALYSIS_PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
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
  if (!parsed || typeof parsed !== "object") throw new Error(`VISION_JSON:${rawText.slice(0, 2000)}`);
  return mapVisionJsonToAsset(parsed as Record<string, unknown>, crypto.randomUUID());
}

async function transcribeAudioGroq(groqApiKey: string, buf: Buffer, fileName: string, mimeType: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(buf)], { type: mimeType });
  formData.append("file", blob, fileName);
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "text");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${groqApiKey}` },
    body: formData,
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq transcription error ${response.status}: ${err}`);
  }
  return (await response.text()).trim();
}

async function extractPdf(buf: Buffer): Promise<string> {
  const pdfParse = _require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
  const data = await pdfParse(buf);
  return normalizeLineBreaks(data.text ?? "");
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = _require("mammoth") as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };
  const result = await mammoth.extractRawText({ buffer: buf });
  return normalizeLineBreaks(result.value ?? "");
}

type PptxSlide = {
  slideNumber: number;
  rawText: string;
  layoutNotes: string;
  visualAssets: ExtractedVisualDescription[];
};

function extractPptx(buf: Buffer): { slides: PptxSlide[]; fullRawText: string } {
  const AdmZip = _require("adm-zip") as new (buf: Buffer) => { getEntries(): { entryName: string; getData(): Buffer }[] };
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  const slideEntries = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => parseInt(a.entryName.match(/\d+/)![0], 10) - parseInt(b.entryName.match(/\d+/)![0], 10));

  const slides: PptxSlide[] = slideEntries.map((entry, i) => {
    const xml = entry.getData().toString("utf-8");
    const textMatches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
    const texts = textMatches.map((t) => t.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    return { slideNumber: i + 1, rawText: texts.join(" "), layoutNotes: "", visualAssets: [] };
  });

  return { slides, fullRawText: slides.map((s) => `Slide ${s.slideNumber}:\n${s.rawText}`).join("\n\n") };
}

export async function extractSourceFromUpload(
  openrouter: OpenAI,
  opts: { visionModel: string; hasOpenRouter: boolean; groqApiKey?: string },
  file: Express.Multer.File
): Promise<ExtractedSource> {
  const id = crypto.randomUUID();
  const fileName = file.originalname || "upload";
  const ext = path.extname(fileName).toLowerCase();
  if (!SOURCE_REWRITER_ALLOWED_EXT.has(ext)) throw new ExtractError(400, { error: "unsupported file type" });

  const fileType = extToFileType(ext);
  const buf = file.buffer;

  if (ext === ".txt" || ext === ".md") {
    return { id, fileName, fileType: "text", fullRawText: normalizeLineBreaks(buf.toString("utf-8")), visualAssets: [], extractionWarnings: [] };
  }

  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
    if (!opts.hasOpenRouter) throw new ExtractError(503, { error: "OPENROUTER_API_KEY not configured" });
    try {
      const mime = file.mimetype && file.mimetype !== "application/octet-stream" ? file.mimetype : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      const asset = await visionExtractImage(openrouter, opts.visionModel, buf, mime);
      return { id, fileName, fileType: "image", fullRawText: asset.visibleText, visualAssets: [asset], extractionWarnings: [] };
    } catch (e) {
      const msg = String(e);
      if (msg.startsWith("VISION_JSON:")) {
        throw new ExtractError(500, { error: "extraction failed", detail: "Invalid model JSON response", raw: msg.slice("VISION_JSON:".length, 2000) });
      }
      throw new ExtractError(500, { error: "extraction failed", detail: msg });
    }
  }

  if (ext === ".docx") {
    try {
      return { id, fileName, fileType: "docx", fullRawText: await extractDocx(buf), visualAssets: [], extractionWarnings: [] };
    } catch (e) {
      throw new ExtractError(500, { error: "DOCX extraction failed", detail: String(e) });
    }
  }

  if (ext === ".pdf") {
    try {
      return { id, fileName, fileType: "pdf", fullRawText: await extractPdf(buf), visualAssets: [], extractionWarnings: [] };
    } catch (e) {
      throw new ExtractError(500, { error: "PDF extraction failed", detail: String(e) });
    }
  }

  if (ext === ".pptx") {
    try {
      const { slides, fullRawText } = extractPptx(buf);
      return { id, fileName, fileType: "presentation", fullRawText, slides, visualAssets: [], extractionWarnings: [] };
    } catch (e) {
      throw new ExtractError(500, { error: "PPTX extraction failed", detail: String(e) });
    }
  }

  if (ext === ".mp3" || ext === ".wav") {
    if (!opts.groqApiKey) return emptyExtractedBase(id, fileName, "audio", ["GROQ_API_KEY not configured — audio transcription unavailable."]);
    try {
      const mime = ext === ".wav" ? "audio/wav" : "audio/mpeg";
      const transcript = await transcribeAudioGroq(opts.groqApiKey, buf, fileName, mime);
      return { id, fileName, fileType: "audio", fullRawText: transcript, transcript, visualAssets: [], extractionWarnings: [] };
    } catch (e) {
      throw new ExtractError(500, { error: "Audio transcription failed", detail: String(e) });
    }
  }

  if (ext === ".mp4" || ext === ".mov") {
    if (!opts.groqApiKey) return emptyExtractedBase(id, fileName, "video", ["GROQ_API_KEY not configured — audio transcription unavailable."]);
    try {
      const mp3Buf = await videoToAudioBuffer(buf, ext);
      const mp3Name = fileName.replace(/\.[^.]+$/, ".mp3");
      const transcript = await transcribeAudioGroq(opts.groqApiKey, mp3Buf, mp3Name, "audio/mpeg");
      return { id, fileName, fileType: "video", fullRawText: transcript, transcript, visualAssets: [], extractionWarnings: [] };
    } catch (e) {
      throw new ExtractError(500, { error: "Video transcription failed", detail: String(e) });
    }
  }

  return emptyExtractedBase(id, fileName, fileType, ["unsupported file type"]);
}

export class ExtractError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(JSON.stringify(body));
    this.name = "ExtractError";
  }
}

export class RewriteError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(JSON.stringify(body));
    this.name = "RewriteError";
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

async function callRewriteModel(openrouter: OpenAI, textModel: string, userContent: string): Promise<string> {
  const completion = await openrouter.chat.completions.create({
    model: textModel,
    max_tokens: 8192,
    messages: [
      { role: "system", content: "You follow instructions exactly. Return only valid JSON. No markdown fences." },
      { role: "user", content: userContent },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}

function normalizeRewritten(parsed: Record<string, unknown>, edited: ExtractedSource, settings: RewriteSettings): RewrittenSource {
  const rp = parsed.rewrittenPages;
  const rs = parsed.rewrittenSlides;
  const rt = parsed.rewrittenTranscript;

  const rewrittenPages = Array.isArray(rp)
    ? rp
        .map((p) => {
          if (!p || typeof p !== "object") return null;
          const o = p as Record<string, unknown>;
          const pageNumber = typeof o.pageNumber === "number" ? o.pageNumber : NaN;
          if (!Number.isFinite(pageNumber)) return null;
          return {
            pageNumber,
            rewrittenText: typeof o.rewrittenText === "string" ? o.rewrittenText : "",
            visualAssets: Array.isArray(o.visualAssets) ? (o.visualAssets as ExtractedVisualDescription[]) : [],
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    : undefined;

  const rewrittenSlides = Array.isArray(rs)
    ? rs
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const o = s as Record<string, unknown>;
          const slideNumber = typeof o.slideNumber === "number" ? o.slideNumber : NaN;
          if (!Number.isFinite(slideNumber)) return null;
          return {
            slideNumber,
            rewrittenText: typeof o.rewrittenText === "string" ? o.rewrittenText : "",
            visualAssets: Array.isArray(o.visualAssets) ? (o.visualAssets as ExtractedVisualDescription[]) : [],
            layoutNotes: typeof o.layoutNotes === "string" ? o.layoutNotes : "",
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    : undefined;

  return {
    id: typeof parsed.id === "string" ? parsed.id : edited.id,
    fileName: typeof parsed.fileName === "string" ? parsed.fileName : edited.fileName,
    fileType: edited.fileType,
    rewriteMode: settings.rewriteMode,
    fullRewrittenText: typeof parsed.fullRewrittenText === "string" ? parsed.fullRewrittenText : "",
    rewrittenPages,
    rewrittenSlides,
    rewrittenTranscript: typeof rt === "string" ? rt : undefined,
    notes: coerceStringArray(parsed.notes),
  };
}

function normalizeCarouselRewritten(parsed: Record<string, unknown>, edited: ExtractedSource, settings: RewriteSettings): RewrittenSource {
  const rawPages = Array.isArray(parsed.rewrittenCarouselPages) ? parsed.rewrittenCarouselPages : [];
  const total = rawPages.length;
  const rewrittenCarouselPages: RewrittenCarouselPage[] = rawPages
    .map((p, index) => {
      if (!p || typeof p !== "object") return null;
      const o = p as Record<string, unknown>;
      const pageNumber = typeof o.pageNumber === "number" && Number.isFinite(o.pageNumber) ? o.pageNumber : index + 1;
      return {
        pageNumber,
        role: coerceCarouselRole(o.role, pageNumber, total),
        rewrittenText: typeof o.rewrittenText === "string" ? o.rewrittenText.trim() : "",
        visualPrompt: typeof o.visualPrompt === "string" ? o.visualPrompt.trim() : "",
        notes: coerceStringArray(o.notes),
      };
    })
    .filter((x): x is RewrittenCarouselPage => x !== null)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const fullRewrittenText =
    typeof parsed.fullRewrittenText === "string" && parsed.fullRewrittenText.trim()
      ? parsed.fullRewrittenText.trim()
      : rewrittenCarouselPages.map((p) => `СТРАНИЦА ${p.pageNumber}\n${p.rewrittenText}`).join("\n\n");

  return {
    id: typeof parsed.id === "string" ? parsed.id : edited.id,
    fileName: typeof parsed.fileName === "string" ? parsed.fileName : edited.fileName,
    fileType: edited.fileType,
    rewriteMode: "carousel_script",
    fullRewrittenText,
    rewrittenCarouselPages,
    rewrittenCaption: typeof parsed.rewrittenCaption === "string" ? parsed.rewrittenCaption : "",
    carouselPromptPack: typeof parsed.carouselPromptPack === "string" ? parsed.carouselPromptPack : "",
    notes: coerceStringArray(parsed.notes),
  };
}

function validateRewritten(out: RewrittenSource, edited: ExtractedSource): { ok: true } | { ok: false; raw: string } {
  if (typeof out.fullRewrittenText !== "string") return { ok: false, raw: "missing fullRewrittenText" };
  if (edited.pages?.length && !Array.isArray(out.rewrittenPages)) return { ok: false, raw: "rewrittenPages must be array when source has pages" };
  if (edited.slides?.length && !Array.isArray(out.rewrittenSlides)) return { ok: false, raw: "rewrittenSlides must be array when source has slides" };
  if (edited.transcript !== undefined && edited.transcript !== "" && !out.rewrittenTranscript && out.fullRewrittenText.length === 0) {
    return { ok: false, raw: "rewrittenTranscript or fullRewrittenText required when transcript present" };
  }
  return { ok: true };
}

function validateCarouselRewritten(out: RewrittenSource, settings: RewriteSettings): { ok: true } | { ok: false; raw: string } {
  const expected = Math.min(Math.max(Number(settings.carouselSlideCount) || 6, 3), 10);
  const pages = out.rewrittenCarouselPages ?? [];
  if (pages.length !== expected) return { ok: false, raw: `rewrittenCarouselPages must contain exactly ${expected} pages` };
  if (pages[0]?.role !== "hook") return { ok: false, raw: "first carousel page must have role hook" };
  if (pages[pages.length - 1]?.role !== "cta") return { ok: false, raw: "last carousel page must have role cta" };
  if (pages.some((p) => !p.rewrittenText.trim())) return { ok: false, raw: "each carousel page must have rewrittenText" };
  if (!out.carouselPromptPack?.trim()) return { ok: false, raw: "carouselPromptPack is required" };
  return { ok: true };
}

function buildChunkRewriteUserPrompt(settings: RewriteSettings, chunk: string, index: number, total: number): string {
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
    const raw = await callRewriteModel(openrouter, textModel, buildChunkRewriteUserPrompt(settings, chunk, i, chunks.length));
    let parsed: unknown;
    try {
      parsed = parseModelJson(raw);
    } catch {
      throw new RewriteError(502, { error: "Invalid model JSON response", raw: raw.slice(0, 2000) });
    }
    const o = parsed as Record<string, unknown>;
    parts.push(typeof o.fullRewrittenText === "string" ? o.fullRewrittenText : "");
  }
  return { id: meta.id, fileName: meta.fileName, fileType: meta.fileType, rewriteMode: settings.rewriteMode, fullRewrittenText: parts.join("\n\n"), notes: [] };
}

async function rewriteCarouselSource(openrouter: OpenAI, textModel: string, edited: ExtractedSource, settings: RewriteSettings): Promise<RewrittenSource> {
  const rawText = await callRewriteModel(openrouter, textModel, buildCarouselRewritePrompt(settings, edited));
  let parsed: unknown;
  try {
    parsed = parseModelJson(rawText);
  } catch {
    throw new RewriteError(502, { error: "Invalid model JSON response", raw: rawText.slice(0, 2000) });
  }
  const out = normalizeCarouselRewritten(parsed as Record<string, unknown>, edited, settings);
  const v = validateCarouselRewritten(out, settings);
  if (!v.ok) throw new RewriteError(502, { error: "Invalid carousel model JSON response", raw: v.raw });
  return out;
}

export async function rewriteSourceRequest(openrouter: OpenAI, textModel: string, body: unknown): Promise<RewrittenSource> {
  if (!body || typeof body !== "object") throw new RewriteError(400, { error: "Invalid body" });
  const b = body as Record<string, unknown>;
  const extractedSource = b.extractedSource;
  const editedSource = b.editedSource;
  const settings = b.settings;

  if (!extractedSource || typeof extractedSource !== "object") throw new RewriteError(400, { error: "extractedSource is required" });
  if (!editedSource || typeof editedSource !== "object") throw new RewriteError(400, { error: "editedSource is required" });
  if (!settings || typeof settings !== "object") throw new RewriteError(400, { error: "settings are required" });

  const edited = editedSource as ExtractedSource;
  const rs = settings as RewriteSettings;

  if (rs.rewriteMode === "carousel_script") {
    return rewriteCarouselSource(openrouter, textModel, edited, rs);
  }

  const payload = JSON.stringify(edited);
  const textPayload = [
    edited.fullRawText,
    ...(edited.pages?.map((p) => p.rawText) ?? []),
    ...(edited.slides?.map((s) => s.rawText) ?? []),
    edited.transcript ?? "",
  ].join("\n\n");

  if (payload.length > PAYLOAD_SAFE && edited.slides?.length) {
    const rewrittenSlides: NonNullable<RewrittenSource["rewrittenSlides"]> = [];
    for (const slide of edited.slides) {
      const mini = { ...edited, slides: [slide], pages: undefined, fullRawText: slide.rawText };
      const rawText = await callRewriteModel(openrouter, textModel, buildRewritePrompt(rs, JSON.stringify(mini)));
      let parsed: unknown;
      try {
        parsed = parseModelJson(rawText);
      } catch {
        throw new RewriteError(502, { error: "Invalid model JSON response", raw: rawText.slice(0, 2000) });
      }
      const norm = normalizeRewritten(parsed as Record<string, unknown>, mini, rs);
      const first = norm.rewrittenSlides?.[0];
      rewrittenSlides.push({
        slideNumber: slide.slideNumber,
        rewrittenText: first?.rewrittenText || norm.fullRewrittenText,
        visualAssets: slide.visualAssets,
        layoutNotes: first?.layoutNotes || slide.layoutNotes,
      });
    }
    const out: RewrittenSource = {
      id: edited.id,
      fileName: edited.fileName,
      fileType: edited.fileType,
      rewriteMode: rs.rewriteMode,
      fullRewrittenText: rewrittenSlides.map((s) => s.rewrittenText).join("\n\n"),
      rewrittenSlides,
      notes: [],
    };
    const v = validateRewritten(out, edited);
    if (!v.ok) throw new RewriteError(502, { error: "Invalid model JSON response", raw: v.raw });
    return out;
  }

  if (payload.length > PAYLOAD_SAFE && edited.pages?.length) {
    const rewrittenPages: NonNullable<RewrittenSource["rewrittenPages"]> = [];
    for (const page of edited.pages) {
      const mini = { ...edited, pages: [page], slides: undefined, fullRawText: page.rawText };
      const rawText = await callRewriteModel(openrouter, textModel, buildRewritePrompt(rs, JSON.stringify(mini)));
      let parsed: unknown;
      try {
        parsed = parseModelJson(rawText);
      } catch {
        throw new RewriteError(502, { error: "Invalid model JSON response", raw: rawText.slice(0, 2000) });
      }
      const norm = normalizeRewritten(parsed as Record<string, unknown>, mini, rs);
      const first = norm.rewrittenPages?.[0];
      rewrittenPages.push({
        pageNumber: page.pageNumber,
        rewrittenText: first?.rewrittenText || norm.fullRewrittenText,
        visualAssets: page.visualAssets,
      });
    }
    const out: RewrittenSource = {
      id: edited.id,
      fileName: edited.fileName,
      fileType: edited.fileType,
      rewriteMode: rs.rewriteMode,
      fullRewrittenText: rewrittenPages.map((p) => p.rewrittenText).join("\n\n"),
      rewrittenPages,
      notes: [],
    };
    const v = validateRewritten(out, edited);
    if (!v.ok) throw new RewriteError(502, { error: "Invalid model JSON response", raw: v.raw });
    return out;
  }

  if (payload.length > PAYLOAD_SAFE || textPayload.length > CHUNK_SIZE) {
    return rewritePlainTextChunks(openrouter, textModel, rs, edited.fullRawText, {
      id: edited.id,
      fileName: edited.fileName,
      fileType: edited.fileType,
    });
  }

  const rawText = await callRewriteModel(openrouter, textModel, buildRewritePrompt(rs, JSON.stringify(edited)));
  let parsed: unknown;
  try {
    parsed = parseModelJson(rawText);
  } catch {
    throw new RewriteError(502, { error: "Invalid model JSON response", raw: rawText.slice(0, 2000) });
  }
  const out = normalizeRewritten(parsed as Record<string, unknown>, edited, rs);
  const v = validateRewritten(out, edited);
  if (!v.ok) throw new RewriteError(502, { error: "Invalid model JSON response", raw: v.raw });
  return out;
}
