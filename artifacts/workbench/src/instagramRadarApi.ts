import type {
  InstagramCompetitor,
  InstagramRadarAudience,
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

export async function fetchInstagramRadarAccountState(): Promise<InstagramRadarListResponse> {
  const response = await fetch("/wb/instagram-radar/competitors");
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as InstagramRadarListResponse;
}

export async function fetchInstagramCompetitors(): Promise<InstagramCompetitor[]> {
  return (await fetchInstagramRadarAccountState()).competitors;
}

export async function saveInstagramCompetitors(
  audience: InstagramRadarAudience,
  urls: string[]
): Promise<InstagramRadarListResponse> {
  const response = await fetch("/wb/instagram-radar/competitors", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audience, urls }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as InstagramRadarListResponse;
}

export async function syncInstagramRadar(
  windowDays: number,
  audience: InstagramRadarAudience
): Promise<InstagramRadarSyncResult> {
  const response = await fetch("/wb/instagram-radar/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ windowDays, audience }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as InstagramRadarSyncResult;
}

export async function fetchInstagramRadarPosts({
  windowDays = 3,
  limit = 30,
  audience,
}: {
  windowDays?: number;
  limit?: number;
  audience?: InstagramRadarAudience;
} = {}) {
  const params = new URLSearchParams({
    windowDays: String(windowDays),
    limit: String(limit),
  });
  if (audience) params.set("audience", audience);
  const response = await fetch(`/wb/instagram-radar/posts?${params.toString()}`);
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as InstagramRadarPostsResponse;
  return data.posts;
}
