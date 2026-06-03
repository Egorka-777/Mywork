import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import OpenAI from "openai";

export type VideoSkeletonResult = {
  skeleton: string;
  frameCount: number;
  warnings: string[];
};

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_FRAMES = 6;
const FRAME_STEP_SECONDS = 3;
const allowedVideoExtensions = new Set([".mp4", ".mov"]);

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-700)}`));
    });
  });
}

async function extractFrames(file: Express.Multer.File) {
  const uid = crypto.randomUUID();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `mywork-video-skeleton-${uid}-`));
  const ext = path.extname(file.originalname || "").toLowerCase() || ".mp4";
  const inputPath = path.join(tmpDir, `input${ext}`);
  const pattern = path.join(tmpDir, "frame-%02d.jpg");

  await fs.writeFile(inputPath, file.buffer);

  try {
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-vf",
      `fps=1/${FRAME_STEP_SECONDS},scale=720:-1`,
      "-frames:v",
      String(MAX_FRAMES),
      pattern,
    ]);

    const files = (await fs.readdir(tmpDir))
      .filter((name) => /^frame-\d+\.jpg$/.test(name))
      .sort();

    const frames = await Promise.all(
      files.map(async (name, index) => ({
        timestampSec: index * FRAME_STEP_SECONDS,
        buffer: await fs.readFile(path.join(tmpDir, name)),
      }))
    );

    return frames;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function buildPrompt(script: string, frameCount: number) {
  return `Ты анализируешь короткое вертикальное видео для создания нового ролика по тому же смысловому и монтажному скелету.

Верни понятный рабочий разбор на русском языке. Не придумывай детали, которых не видно на кадрах и которых нет в тексте. Если данных недостаточно — так и напиши.

Нужно выдать строго эти разделы:

# Хук
- чем ролик цепляет в первые секунды;
- какой новый хук можно использовать без копирования формулировок.

# Монтажный скелет
Для каждой различимой сцены:
- примерный таймкод;
- что видно в кадре;
- действие персонажа или объекта;
- тип плана и движение камеры, если это можно определить;
- роль сцены: hook / setup / proof / explanation / transition / CTA;
- что сохранить при адаптации;
- что можно заменить под новый ролик.

# Ритм
- примерное количество сцен;
- частота смены кадров;
- где нужны перебивки, текст на экране или акценты.

# Текст для озвучки
- оцени, соответствует ли приложенный текст структуре ролика;
- предложи короткие точечные правки, если текст стоит усилить.

# Готовая инструкция для пересборки
- пошагово, какие кадры снять или сгенерировать;
- в каком порядке собрать;
- где вставить озвучку;
- где оставить паузы.

Количество извлечённых опорных кадров: ${frameCount}.

Текст для озвучки, если он уже подготовлен:
${script.trim() || "Текст пока не добавлен."}`;
}

export async function analyzeSourceVideoSkeleton(
  file: Express.Multer.File,
  script = ""
): Promise<VideoSkeletonResult> {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!allowedVideoExtensions.has(ext)) {
    throw new Error("Only MP4 and MOV source videos are supported");
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error("Source video is too large. Max size is 100 MB");
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || "";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const frames = await extractFrames(file);
  if (frames.length === 0) throw new Error("No frames extracted from source video");

  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
  const model = process.env.OPENROUTER_VISION_MODEL?.trim() || "google/gemini-2.0-flash-001";
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: buildPrompt(script, frames.length) },
  ];

  for (const frame of frames) {
    content.push({ type: "text", text: `Опорный кадр, примерно ${frame.timestampSec} сек.` });
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${frame.buffer.toString("base64")}` },
    });
  }

  const completion = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content: "Ты анализируешь только видимые факты и текст пользователя. Не выдумывай детали. Верни рабочий разбор на русском языке.",
      },
      { role: "user", content: content as never },
    ],
  });

  const skeleton = completion.choices[0]?.message?.content?.trim() || "";
  if (!skeleton) throw new Error("Vision model returned empty video skeleton");

  return {
    skeleton,
    frameCount: frames.length,
    warnings: frames.length < MAX_FRAMES ? ["Из видео удалось извлечь меньше 6 опорных кадров."] : [],
  };
}
