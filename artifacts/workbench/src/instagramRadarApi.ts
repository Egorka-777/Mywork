import type {
  InstagramCompetitor,
  InstagramRadarListResponse,
  InstagramRadarPostsResponse,
  InstagramRadarSyncResult,
} from "./instagramRadarTypes";

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

export async function fetchInstagramCompetitors(): Promise<InstagramCompetitor[]> {
  const response = await fetch("/wb/instagram-radar/competitors");
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as InstagramRadarListResponse;
  return data.competitors;
}

export async function saveInstagramCompetitors(urls: string[]): Promise<InstagramCompetitor[]> {
  const response = await fetch("/wb/instagram-radar/competitors", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as InstagramRadarListResponse;
  return data.competitors;
}

export async function syncInstagramRadar(windowDays: number): Promise<InstagramRadarSyncResult> {
  const response = await fetch("/wb/instagram-radar/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ windowDays }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as InstagramRadarSyncResult;
}

export async function fetchInstagramRadarPosts({
  windowDays = 3,
  limit = 30,
}: {
  windowDays?: number;
  limit?: number;
} = {}) {
  const params = new URLSearchParams({
    windowDays: String(windowDays),
    limit: String(limit),
  });
  const response = await fetch(`/wb/instagram-radar/posts?${params.toString()}`);
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as InstagramRadarPostsResponse;
  return data.posts;
}
