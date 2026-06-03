import type {
  CreateLipsyncJobInput,
  LipsyncAudioUploadResponse,
  LipsyncJob,
  LipsyncJobResponse,
  LipsyncJobsResponse,
  VideoSkeletonResponse,
} from "./lipsyncTypes";

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `${response.status} ${response.statusText}`;

  try {
    const data = JSON.parse(text) as { error?: string; detail?: unknown };
    const detail = data.detail ? ` — ${typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)}` : "";
    return `${data.error ?? text}${detail}`;
  } catch {
    return text;
  }
}

export async function analyzeSourceVideoSkeleton(file: File, script: string): Promise<VideoSkeletonResponse> {
  const body = new FormData();
  body.append("video", file);
  body.append("script", script);
  const response = await fetch("/wb/lipsync/analyze-source-video", { method: "POST", body });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as VideoSkeletonResponse;
}

export async function uploadLipsyncAudio(file: File): Promise<LipsyncAudioUploadResponse> {
  const body = new FormData();
  body.append("audio", file);
  const response = await fetch("/wb/lipsync/upload-audio", { method: "POST", body });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as LipsyncAudioUploadResponse;
}

export async function fetchLipsyncJobs(): Promise<LipsyncJob[]> {
  const response = await fetch("/wb/lipsync/jobs");
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as LipsyncJobsResponse;
  return data.jobs;
}

export async function createLipsyncJob(input: CreateLipsyncJobInput): Promise<LipsyncJob> {
  const response = await fetch("/wb/lipsync/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as LipsyncJobResponse;
  return data.job;
}

export async function fetchLipsyncJob(id: string): Promise<LipsyncJob> {
  const response = await fetch(`/wb/lipsync/jobs/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as LipsyncJobResponse;
  return data.job;
}

export async function deleteLipsyncJob(id: string): Promise<LipsyncJob[]> {
  const response = await fetch(`/wb/lipsync/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as LipsyncJobsResponse;
  return data.jobs;
}

export async function markLipsyncReady(id: string): Promise<LipsyncJob> {
  const response = await fetch(`/wb/lipsync/jobs/${encodeURIComponent(id)}/ready`, { method: "POST" });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as LipsyncJobResponse;
  return data.job;
}

export async function renderLipsyncJob(id: string): Promise<LipsyncJob> {
  const response = await fetch(`/wb/lipsync/jobs/${encodeURIComponent(id)}/render`, { method: "POST" });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as LipsyncJobResponse;
  return data.job;
}

export async function refreshLipsyncJob(id: string): Promise<LipsyncJob> {
  const response = await fetch(`/wb/lipsync/jobs/${encodeURIComponent(id)}/refresh`, { method: "POST" });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as LipsyncJobResponse;
  return data.job;
}
