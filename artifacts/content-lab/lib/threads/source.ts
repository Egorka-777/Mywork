import type { CandidatePost } from "@/lib/content/score";
export type { CandidatePost } from "@/lib/content/score";

const BASE = "https://graph.threads.net/v1.0";

function withToken(url: string, accessToken: string) {
  const u = new URL(url);
  u.searchParams.set("access_token", accessToken);
  return u.toString();
}

function pickNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function asPost(raw: Record<string, unknown>, username?: string): CandidatePost | null {
  const id = raw.id;
  if (typeof id !== "string" || !id) return null;
  const text = typeof raw.text === "string" ? raw.text : "";
  if (!text) return null;
  const ts =
    typeof raw.timestamp === "string"
      ? raw.timestamp
      : typeof (raw as { time?: string }).time === "string"
        ? (raw as { time: string }).time
        : undefined;
  return {
    id,
    text,
    permalink: typeof raw.permalink === "string" ? raw.permalink : undefined,
    username:
      (typeof raw.username === "string" && raw.username) || username,
    like_count: pickNum(raw.like_count),
    reply_count: pickNum(raw.reply_count),
    repost_count: pickNum(
      (raw as { reshare_count?: number }).reshare_count ?? raw.repost_count,
    ),
    quote_count: pickNum(
      (raw as { quote_count?: number }).quote_count,
    ),
    timestamp: ts,
  };
}

function extractList(json: unknown): unknown[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  if (Array.isArray(o.data)) return o.data;
  if (Array.isArray((o as { media?: unknown[] }).media)) {
    return (o as { media: unknown[] }).media;
  }
  if (Array.isArray(o.threads)) return o.threads as unknown[];
  return [];
}

/**
 * A) Public profile posts (requires permissions + `username` in query).
 * Path follows Meta: GET /v1.0/{threads-user-id}/profile_posts
 */
export async function fetchCompetitorProfilePosts(input: {
  threadsUserId: string;
  accessToken: string;
  username: string;
  limit: number;
}): Promise<CandidatePost[]> {
  const handle = input.username.replace(/^@+/, "");
  const fields = [
    "id",
    "text",
    "like_count",
    "reply_count",
    "repost_count",
    "reshare_count",
    "quote_count",
    "timestamp",
    "permalink",
    "username",
  ].join(",");
  const url = new URL(`${BASE}/${input.threadsUserId}/profile_posts`);
  url.searchParams.set("username", handle);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", String(input.limit));
  const res = await fetch(withToken(url.toString(), input.accessToken), {
    cache: "no-store",
  });
  const json = (await res.json()) as { error?: { message: string } };
  if (!res.ok) {
    throw new Error(
      `profile_posts failed: ${res.status} ${JSON.stringify(json)}`,
    );
  }
  const out: CandidatePost[] = [];
  for (const row of extractList(json)) {
    if (!row || typeof row !== "object") continue;
    const p = asPost(row as Record<string, unknown>, handle);
    if (p) out.push(p);
  }
  return out;
}

/**
 * B) Keyword / topic (needs `threads_keyword_search` to search public, not just own posts).
 */
export async function fetchKeywordSearch(input: {
  accessToken: string;
  q: string;
  searchType: "TOP" | "RECENT";
  authorUsername?: string;
  limit: number;
  mediaType?: "TEXT" | "IMAGE" | "VIDEO" | "CAROUSEL";
}): Promise<CandidatePost[]> {
  const url = new URL(`${BASE}/keyword_search`);
  url.searchParams.set("q", input.q);
  url.searchParams.set("search_type", input.searchType);
  url.searchParams.set("limit", String(input.limit));
  if (input.authorUsername) {
    url.searchParams.set("author_username", input.authorUsername.replace(/^@+/, ""));
  }
  if (input.mediaType) {
    url.searchParams.set("media_type", input.mediaType);
  }
  const res = await fetch(withToken(url.toString(), input.accessToken), {
    cache: "no-store",
  });
  const json = (await res.json()) as { error?: { message: string } };
  if (!res.ok) {
    throw new Error(
      `keyword_search failed: ${res.status} ${JSON.stringify(json)}`,
    );
  }
  const out: CandidatePost[] = [];
  for (const row of extractList(json)) {
    if (!row || typeof row !== "object") continue;
    const p = asPost(row as Record<string, unknown>);
    if (p) out.push(p);
  }
  return out;
}

/** Keep posts from the last `maxDays` (and not in the future). */
export function postWithinLookback(
  p: CandidatePost,
  maxDays: number,
): boolean {
  if (!p.timestamp) return true;
  const t = new Date(p.timestamp).getTime();
  if (Number.isNaN(t)) return true;
  const ageH = (Date.now() - t) / 36e5;
  return ageH >= 0 && ageH <= maxDays * 24;
}
