import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFaceAssetFile, readFaceAssets } from "./assetVault";

export type LipsyncJobStatus =
  | "draft"
  | "ready_for_render"
  | "provider_not_configured"
  | "rendering"
  | "succeeded"
  | "failed";

export type LipsyncVideoFormat = "vertical_9_16" | "square_1_1" | "portrait_4_5";
export type LipsyncResolution = "480p" | "720p";

export type LipsyncJob = {
  id: string;
  title: string;
  script: string;
  faceAssetId: string | null;
  faceAssetName: string | null;
  faceFalUrl: string | null;
  audioUrl: string | null;
  audioFileName: string | null;
  provider: "fal.ai";
  modelId: "creatify_aurora";
  videoFormat: LipsyncVideoFormat;
  resolution: LipsyncResolution;
  status: LipsyncJobStatus;
  requestId: string | null;
  statusUrl: string | null;
  responseUrl: string | null;
  resultUrl: string | null;
  error: string | null;
  source: "manual" | "source_rewriter";
  sourceTitle: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateLipsyncJobInput = {
  title?: unknown;
  script?: unknown;
  faceAssetId?: unknown;
  audioUrl?: unknown;
  audioFileName?: unknown;
  videoFormat?: unknown;
  resolution?: unknown;
  source?: unknown;
  sourceTitle?: unknown;
};

const AURORA_ENDPOINT = "fal-ai/creatify/aurora";
const AURORA_MODEL_ID = "creatify_aurora" as const;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workbenchRoot = path.resolve(__dirname, "..");
const lipsyncDir = path.join(workbenchRoot, "data", "lipsync");
const jobsFile = path.join(lipsyncDir, "jobs.json");
const allowedAudioExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]);

async function ensureLipsyncDir() {
  await fs.mkdir(lipsyncDir, { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await ensureLipsyncDir();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tmpPath, filePath);
}

function asVideoFormat(value: unknown): LipsyncVideoFormat {
  if (value === "square_1_1" || value === "portrait_4_5" || value === "vertical_9_16") return value;
  return "vertical_9_16";
}

function asResolution(value: unknown): LipsyncResolution {
  return value === "720p" ? "720p" : "480p";
}

function asSource(value: unknown): "manual" | "source_rewriter" {
  return value === "source_rewriter" ? "source_rewriter" : "manual";
}

function cleanString(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function optionalString(value: unknown, maxLength = 2_000) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function getFalKey() {
  const key = process.env.FAL_KEY?.trim() || "";
  if (!key) throw new Error("FAL_KEY is not configured");
  return key;
}

function normalizeStoredJob(raw: Partial<LipsyncJob>): LipsyncJob {
  const now = new Date().toISOString();
  return {
    id: raw.id || randomUUID(),
    title: raw.title || "lipsync-video",
    script: raw.script || "",
    faceAssetId: raw.faceAssetId ?? null,
    faceAssetName: raw.faceAssetName ?? null,
    faceFalUrl: raw.faceFalUrl ?? null,
    audioUrl: raw.audioUrl ?? null,
    audioFileName: raw.audioFileName ?? null,
    provider: "fal.ai",
    modelId: AURORA_MODEL_ID,
    videoFormat: asVideoFormat(raw.videoFormat),
    resolution: asResolution(raw.resolution),
    status: raw.status || "draft",
    requestId: raw.requestId ?? null,
    statusUrl: raw.statusUrl ?? null,
    responseUrl: raw.responseUrl ?? null,
    resultUrl: raw.resultUrl ?? null,
    error: raw.error ?? null,
    source: asSource(raw.source),
    sourceTitle: raw.sourceTitle ?? null,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

async function updateLipsyncJob(id: string, patch: Partial<LipsyncJob>): Promise<LipsyncJob> {
  const jobs = await readLipsyncJobs();
  const current = jobs.find((item) => item.id === id);
  if (!current) throw new Error("Lipsync job not found");
  const updated = normalizeStoredJob({ ...current, ...patch, id, updatedAt: new Date().toISOString() });
  await saveLipsyncJobs(jobs.map((item) => (item.id === id ? updated : item)));
  return updated;
}

export async function uploadBufferToFalStorage(buffer: Buffer, contentType: string, fileName: string): Promise<string> {
  const key = getFalKey();
  const initiate = await fetch("https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ content_type: contentType, file_name: fileName }),
  });
  if (!initiate.ok) {
    const detail = await initiate.text().catch(() => "");
    throw new Error(`FAL storage initiate failed: ${initiate.status}${detail ? ` — ${detail}` : ""}`);
  }
  const { upload_url, file_url } = (await initiate.json()) as { upload_url: string; file_url: string };
  const upload = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(buffer),
  });
  if (!upload.ok) throw new Error(`FAL storage upload failed: ${upload.status}`);
  return file_url;
}

export async function uploadLipsyncAudio(file: Express.Multer.File): Promise<{ url: string; fileName: string }> {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = (file.mimetype || "").toLowerCase();
  if (!mime.startsWith("audio/") && !allowedAudioExtensions.has(ext)) {
    throw new Error("Only audio files are supported: mp3, wav, m4a, aac, ogg, flac, opus");
  }
  if (file.size > 50 * 1024 * 1024) throw new Error("Audio file is too large. Max size is 50 MB");
  const fileName = file.originalname || `voice${ext || ".mp3"}`;
  const url = await uploadBufferToFalStorage(file.buffer, file.mimetype || "audio/mpeg", fileName);
  return { url, fileName };
}

async function ensureFaceFalUrl(job: LipsyncJob): Promise<string> {
  if (job.faceFalUrl) return job.faceFalUrl;
  if (!job.faceAssetId) throw new Error("Select an avatar from Asset Vault");
  const { filePath, face } = await readFaceAssetFile(job.faceAssetId);
  const buffer = await fs.readFile(filePath);
  return uploadBufferToFalStorage(buffer, face.mimeType, face.filename);
}

async function submitAuroraQueue(job: LipsyncJob, faceFalUrl: string) {
  if (!job.audioUrl) throw new Error("Upload ElevenLabs audio before render");
  const key = getFalKey();
  const response = await fetch(`https://queue.fal.run/${AURORA_ENDPOINT}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: faceFalUrl,
      audio_url: job.audioUrl,
      resolution: job.resolution,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Creatify Aurora submit failed: ${response.status}${detail ? ` — ${detail}` : ""}`);
  }
  return (await response.json()) as {
    request_id: string;
    status_url?: string;
    response_url?: string;
  };
}

function extractVideoUrl(result: Record<string, unknown>) {
  const video = result.video as { url?: unknown } | string | undefined;
  if (typeof video === "string") return video;
  if (video && typeof video.url === "string") return video.url;
  const videos = result.videos as Array<{ url?: unknown }> | undefined;
  if (Array.isArray(videos) && typeof videos[0]?.url === "string") return videos[0].url;
  const output = result.output as Array<{ url?: unknown }> | { url?: unknown } | undefined;
  if (Array.isArray(output) && typeof output[0]?.url === "string") return output[0].url;
  if (output && !Array.isArray(output) && typeof output.url === "string") return output.url;
  return typeof result.url === "string" ? result.url : "";
}

export async function readLipsyncJobs(): Promise<LipsyncJob[]> {
  await ensureLipsyncDir();
  const jobs = await readJsonFile<Array<Partial<LipsyncJob>>>(jobsFile, []);
  return Array.isArray(jobs) ? jobs.map(normalizeStoredJob) : [];
}

export async function saveLipsyncJobs(jobs: LipsyncJob[]) {
  await writeJsonAtomic(jobsFile, jobs);
}

export async function readLipsyncJob(id: string): Promise<LipsyncJob> {
  const jobs = await readLipsyncJobs();
  const job = jobs.find((item) => item.id === id);
  if (!job) throw new Error("Lipsync job not found");
  return job;
}

export async function createLipsyncJob(input: CreateLipsyncJobInput): Promise<LipsyncJob> {
  const now = new Date().toISOString();
  const script = cleanString(input.script, "", 20_000);
  if (!script) throw new Error("script is required");
  const faceAssetId = optionalString(input.faceAssetId, 200);
  const audioUrl = optionalString(input.audioUrl);
  const faces = await readFaceAssets();
  const face = faceAssetId ? faces.find((item) => item.id === faceAssetId) : null;
  if (faceAssetId && !face) throw new Error("Selected face asset not found");
  const hasFalKey = Boolean(process.env.FAL_KEY?.trim());
  const ready = hasFalKey && Boolean(faceAssetId) && Boolean(audioUrl);
  const job: LipsyncJob = {
    id: randomUUID(),
    title: cleanString(input.title, "lipsync-video", 120),
    script,
    faceAssetId,
    faceAssetName: face?.name ?? null,
    faceFalUrl: null,
    audioUrl,
    audioFileName: optionalString(input.audioFileName, 240),
    provider: "fal.ai",
    modelId: AURORA_MODEL_ID,
    videoFormat: asVideoFormat(input.videoFormat),
    resolution: asResolution(input.resolution),
    status: ready ? "ready_for_render" : "provider_not_configured",
    requestId: null,
    statusUrl: null,
    responseUrl: null,
    resultUrl: null,
    error: ready ? null : "Add FAL_KEY, select an avatar and upload ElevenLabs audio before render.",
    source: asSource(input.source),
    sourceTitle: optionalString(input.sourceTitle, 160),
    createdAt: now,
    updatedAt: now,
  };
  await saveLipsyncJobs([job, ...(await readLipsyncJobs())]);
  return job;
}

export async function deleteLipsyncJob(id: string): Promise<LipsyncJob[]> {
  const jobs = await readLipsyncJobs();
  const next = jobs.filter((item) => item.id !== id);
  if (next.length === jobs.length) throw new Error("Lipsync job not found");
  await saveLipsyncJobs(next);
  return next;
}

export async function markLipsyncJobReady(id: string): Promise<LipsyncJob> {
  const current = await readLipsyncJob(id);
  const ready = Boolean(process.env.FAL_KEY?.trim() && current.faceAssetId && current.audioUrl);
  return updateLipsyncJob(id, {
    status: ready ? "ready_for_render" : "provider_not_configured",
    error: ready ? null : "Add FAL_KEY, select an avatar and upload ElevenLabs audio before render.",
  });
}

export async function renderLipsyncJob(id: string): Promise<LipsyncJob> {
  const current = await readLipsyncJob(id);
  if (current.status === "rendering") return refreshLipsyncJob(id);
  if (!current.faceAssetId) throw new Error("Select an avatar from Asset Vault");
  if (!current.audioUrl) throw new Error("Upload ElevenLabs audio before render");
  try {
    const faceFalUrl = await ensureFaceFalUrl(current);
    const queued = await submitAuroraQueue(current, faceFalUrl);
    return updateLipsyncJob(id, {
      faceFalUrl,
      status: "rendering",
      requestId: queued.request_id,
      statusUrl: queued.status_url ?? null,
      responseUrl: queued.response_url ?? null,
      resultUrl: null,
      error: null,
    });
  } catch (error) {
    await updateLipsyncJob(id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function refreshLipsyncJob(id: string): Promise<LipsyncJob> {
  const current = await readLipsyncJob(id);
  if (current.status !== "rendering") return current;
  if (!current.requestId) return updateLipsyncJob(id, { status: "failed", error: "Missing Fal.ai request id" });
  const key = getFalKey();
  const statusUrl = current.statusUrl || `https://queue.fal.run/${AURORA_ENDPOINT}/requests/${current.requestId}/status`;
  const statusRequestUrl = new URL(statusUrl);
  statusRequestUrl.searchParams.set("logs", "1");
  const response = await fetch(statusRequestUrl, { headers: { Authorization: `Key ${key}` } });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Creatify Aurora status failed: ${response.status}${detail ? ` — ${detail}` : ""}`);
  }
  const status = (await response.json()) as { status?: string; error?: string; response_url?: string };
  const normalized = String(status.status || "").toUpperCase();
  if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(normalized)) {
    return updateLipsyncJob(id, { status: "failed", error: status.error || "Creatify Aurora render failed" });
  }
  if (normalized !== "COMPLETED") return current;
  const responseUrl = status.response_url || current.responseUrl || `https://queue.fal.run/${AURORA_ENDPOINT}/requests/${current.requestId}/response`;
  const resultResponse = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
  if (!resultResponse.ok) {
    const detail = await resultResponse.text().catch(() => "");
    throw new Error(`Creatify Aurora result failed: ${resultResponse.status}${detail ? ` — ${detail}` : ""}`);
  }
  const result = (await resultResponse.json()) as Record<string, unknown>;
  const resultUrl = extractVideoUrl(result);
  if (!resultUrl) return updateLipsyncJob(id, { status: "failed", error: "Creatify Aurora returned no video URL" });
  return updateLipsyncJob(id, { status: "succeeded", resultUrl, responseUrl, error: null });
}

export const lipsyncRuntimeConfig = {
  endpoint: AURORA_ENDPOINT,
  modelId: AURORA_MODEL_ID,
  resolutions: ["480p", "720p"] as LipsyncResolution[],
};
