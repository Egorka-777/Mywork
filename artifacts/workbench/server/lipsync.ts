import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFaceAssets } from "./assetVault";

export type LipsyncJobStatus =
  | "draft"
  | "ready_for_render"
  | "provider_not_configured"
  | "rendering"
  | "succeeded"
  | "failed";

export type LipsyncVideoFormat = "vertical_9_16" | "square_1_1" | "portrait_4_5";

export type LipsyncJob = {
  id: string;
  title: string;
  script: string;
  faceAssetId: string | null;
  faceAssetName: string | null;
  provider: "fal.ai";
  modelId: string | null;
  videoFormat: LipsyncVideoFormat;
  status: LipsyncJobStatus;
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
  videoFormat?: unknown;
  source?: unknown;
  sourceTitle?: unknown;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workbenchRoot = path.resolve(__dirname, "..");
const lipsyncDir = path.join(workbenchRoot, "data", "lipsync");
const jobsFile = path.join(lipsyncDir, "jobs.json");

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
  if (value === "square_1_1" || value === "portrait_4_5" || value === "vertical_9_16") {
    return value;
  }
  return "vertical_9_16";
}

function asSource(value: unknown): "manual" | "source_rewriter" {
  return value === "source_rewriter" ? "source_rewriter" : "manual";
}

function cleanString(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

export async function readLipsyncJobs(): Promise<LipsyncJob[]> {
  await ensureLipsyncDir();
  const jobs = await readJsonFile<LipsyncJob[]>(jobsFile, []);
  return Array.isArray(jobs) ? jobs : [];
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

  const faceAssetId = typeof input.faceAssetId === "string" && input.faceAssetId.trim()
    ? input.faceAssetId.trim()
    : null;

  const faces = await readFaceAssets();
  const face = faceAssetId ? faces.find((item) => item.id === faceAssetId) : null;
  if (faceAssetId && !face) throw new Error("Selected face asset not found");

  const modelId = process.env.FAL_LIPSYNC_MODEL_ID?.trim() || null;
  const hasFalKey = Boolean(process.env.FAL_KEY?.trim());
  const status: LipsyncJobStatus = hasFalKey && modelId && faceAssetId
    ? "ready_for_render"
    : "provider_not_configured";

  const job: LipsyncJob = {
    id: randomUUID(),
    title: cleanString(input.title, "lipsync-job", 120),
    script,
    faceAssetId,
    faceAssetName: face?.name ?? null,
    provider: "fal.ai",
    modelId,
    videoFormat: asVideoFormat(input.videoFormat),
    status,
    resultUrl: null,
    error: status === "provider_not_configured"
      ? "Fal.ai render is not configured yet. Set FAL_KEY, FAL_LIPSYNC_MODEL_ID and select a face asset."
      : null,
    source: asSource(input.source),
    sourceTitle: typeof input.sourceTitle === "string" && input.sourceTitle.trim() ? input.sourceTitle.trim().slice(0, 160) : null,
    createdAt: now,
    updatedAt: now,
  };

  const jobs = [job, ...(await readLipsyncJobs())];
  await saveLipsyncJobs(jobs);
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
  const jobs = await readLipsyncJobs();
  const current = jobs.find((item) => item.id === id);
  if (!current) throw new Error("Lipsync job not found");

  const modelId = process.env.FAL_LIPSYNC_MODEL_ID?.trim() || null;
  const hasFalKey = Boolean(process.env.FAL_KEY?.trim());
  const ready = hasFalKey && modelId && current.faceAssetId;
  const updated: LipsyncJob = {
    ...current,
    modelId,
    status: ready ? "ready_for_render" : "provider_not_configured",
    error: ready ? null : "Fal.ai render is not configured yet. Set FAL_KEY, FAL_LIPSYNC_MODEL_ID and select a face asset.",
    updatedAt: new Date().toISOString(),
  };

  const next = jobs.map((item) => (item.id === id ? updated : item));
  await saveLipsyncJobs(next);
  return updated;
}
