import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export type InstagramCompetitor = {
  id: string;
  url: string;
  username: string;
  label: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InstagramRadarPostType = "carousel" | "reel" | "image" | "video" | "unknown";

export type InstagramRadarPost = {
  id: string;
  competitorId: string;
  competitorUsername: string;
  url: string;
  shortcode: string | null;
  caption: string;
  postType: InstagramRadarPostType;
  timestamp: string | null;
  likesCount: number | null;
  commentsCount: number | null;
  videoViewCount: number | null;
  playCount: number | null;
  imageUrls: string[];
  thumbnailUrl: string | null;
  score: number;
  scoreReason: string;
  fetchedAt: string;
};

export type InstagramRadarSyncResult = {
  ok: boolean;
  windowDays: number;
  competitorsChecked: number;
  postsFound: number;
  postsKept: number;
  posts: InstagramRadarPost[];
};

type ScoreInput = Pick<
  InstagramRadarPost,
  "postType" | "timestamp" | "likesCount" | "commentsCount" | "videoViewCount" | "playCount"
>;

type ProviderInput = {
  competitor: InstagramCompetitor;
  apifyToken: string;
  apifyActorId: string;
  resultsLimit?: number;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workbenchRoot = path.resolve(__dirname, "..");
const radarDir = path.join(workbenchRoot, "data", "instagram-radar");
const competitorsFile = path.join(radarDir, "competitors.json");
const postsCacheFile = path.join(radarDir, "posts-cache.json");
const syncLogFile = path.join(radarDir, "sync-log.jsonl");

async function ensureRadarDir() {
  await fs.mkdir(radarDir, { recursive: true });
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
  await ensureRadarDir();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tmpPath, filePath);
}

async function appendSyncLog(entry: Record<string, unknown>) {
  await ensureRadarDir();
  await fs.appendFile(syncLogFile, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, "utf-8");
}

function normalizeApifyActorId(actorId: string) {
  return actorId.includes("/") ? actorId.replace("/", "~") : actorId;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const normalized = Number(value.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(normalized)) return normalized;
    }
  }
  return null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function collectImageUrls(item: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const pushUrl = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//.test(value)) urls.push(value);
  };

  pushUrl(item.displayUrl);
  pushUrl(item.imageUrl);
  pushUrl(item.thumbnailUrl);
  pushUrl(item.thumbnail);

  if (Array.isArray(item.images)) item.images.forEach(pushUrl);

  const childPosts = item.childPosts;
  if (Array.isArray(childPosts)) {
    childPosts.forEach((child) => {
      if (!child || typeof child !== "object") return;
      const c = child as Record<string, unknown>;
      pushUrl(c.displayUrl);
      pushUrl(c.imageUrl);
      pushUrl(c.thumbnailUrl);
    });
  }

  const carouselMedia = item.carouselMedia;
  if (Array.isArray(carouselMedia)) {
    carouselMedia.forEach((media) => {
      if (!media || typeof media !== "object") return;
      const m = media as Record<string, unknown>;
      pushUrl(m.displayUrl);
      pushUrl(m.imageUrl);
      pushUrl(m.thumbnailUrl);
    });
  }

  return Array.from(new Set(urls));
}

function detectPostType(item: Record<string, unknown>, imageUrls: string[]): InstagramRadarPostType {
  const type = firstString(item.type, item.productType, item.mediaType, item.__typename).toLowerCase();
  if (type.includes("sidecar") || type.includes("carousel") || imageUrls.length > 1) return "carousel";
  if (type.includes("reel")) return "reel";
  if (type.includes("video")) return "video";
  if (type.includes("image") || type.includes("photo")) return "image";
  return "unknown";
}

function buildPostUrl(item: Record<string, unknown>, username: string, shortcode: string | null): string {
  const directUrl = firstString(item.url, item.inputUrl, item.postUrl);
  if (directUrl && /^https?:\/\//.test(directUrl)) return directUrl;
  if (shortcode) return `https://www.instagram.com/p/${shortcode}/`;
  return `https://www.instagram.com/${username}/`;
}

export function normalizeInstagramProfileUrl(inputUrl: string): { url: string; username: string } {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl.trim());
  } catch {
    throw new Error("Invalid Instagram profile URL");
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "instagram.com" && host !== "www.instagram.com") {
    throw new Error("Only instagram.com profile URLs are supported");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const username = segments[0]?.toLowerCase();
  if (!username) throw new Error("Instagram username is required");
  if (["p", "reel", "tv", "stories"].includes(username)) {
    throw new Error("Use competitor profile URLs, not post/reel/story URLs");
  }
  if (!/^[a-z0-9._]+$/.test(username)) {
    throw new Error(`Invalid Instagram username: ${username}`);
  }

  return {
    username,
    url: `https://www.instagram.com/${username}/`,
  };
}

export function scoreInstagramPost(post: ScoreInput): { score: number; scoreReason: string } {
  const likes = post.likesCount ?? 0;
  const comments = post.commentsCount ?? 0;
  const views = post.videoViewCount ?? post.playCount ?? 0;
  const carouselBonus = post.postType === "carousel" ? 50 : 0;
  const ts = post.timestamp ? new Date(post.timestamp).getTime() : NaN;
  const recentBonus = Number.isFinite(ts) && Date.now() - ts <= 24 * 60 * 60 * 1000 ? 100 : 0;
  const score = Math.round(likes + comments * 4 + views * 0.05 + carouselBonus + recentBonus);

  const missingMetrics = likes === 0 && comments === 0 && views === 0;
  const scoreReason = missingMetrics
    ? `metrics missing, ranked mostly by recency/type; carousel bonus ${carouselBonus} + recency bonus ${recentBonus}`
    : `likes ${likes} + comments ${comments}*4 + views ${views}*0.05 + carousel bonus ${carouselBonus} + recency bonus ${recentBonus}`;

  return { score, scoreReason };
}

export async function readInstagramCompetitors(): Promise<InstagramCompetitor[]> {
  await ensureRadarDir();
  const competitors = await readJsonFile<InstagramCompetitor[]>(competitorsFile, []);
  return Array.isArray(competitors) ? competitors : [];
}

export async function saveInstagramCompetitors(urls: string[]): Promise<InstagramCompetitor[]> {
  if (!Array.isArray(urls)) throw new Error("urls must be an array");

  const now = new Date().toISOString();
  const existing = await readInstagramCompetitors();
  const existingByUsername = new Map(existing.map((competitor) => [competitor.username, competitor]));
  const normalized = urls
    .map((url) => url.trim())
    .filter(Boolean)
    .map(normalizeInstagramProfileUrl);

  const unique = new Map<string, { url: string; username: string }>();
  normalized.forEach((item) => unique.set(item.username, item));

  const competitors = Array.from(unique.values()).map((item) => {
    const old = existingByUsername.get(item.username);
    return {
      id: old?.id ?? randomUUID(),
      url: item.url,
      username: item.username,
      label: old?.label || `@${item.username}`,
      active: true,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    } satisfies InstagramCompetitor;
  });

  await writeJsonAtomic(competitorsFile, competitors);
  return competitors;
}

export async function readInstagramRadarPosts(): Promise<InstagramRadarPost[]> {
  await ensureRadarDir();
  const posts = await readJsonFile<InstagramRadarPost[]>(postsCacheFile, []);
  return Array.isArray(posts) ? posts : [];
}

export function filterRecentPosts(posts: InstagramRadarPost[], windowDays: number, limit: number): InstagramRadarPost[] {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  return posts
    .filter((post) => {
      if (!post.timestamp) return true;
      const ts = new Date(post.timestamp).getTime();
      return Number.isFinite(ts) ? ts >= cutoff : true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function fetchRecentPostsForCompetitor({
  competitor,
  apifyToken,
  apifyActorId,
  resultsLimit = 12,
}: ProviderInput): Promise<InstagramRadarPost[]> {
  if (!apifyToken) throw new Error("APIFY_TOKEN not configured");
  if (!apifyActorId) throw new Error("APIFY_ACTOR_ID not configured");

  const actorId = normalizeApifyActorId(apifyActorId);
  const apifyUrl =
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items` +
    `?format=json&clean=true&maxItems=100&timeout=120`;

  const input = {
    resultsType: "posts",
    directUrls: [competitor.url],
    resultsLimit,
    searchType: "hashtag",
    searchLimit: 1,
    addParentData: false,
  };

  const response = await fetch(apifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apifyToken}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Apify request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 500)}` : ""}`);
  }

  const items = (await response.json()) as unknown;
  if (!Array.isArray(items)) {
    throw new Error("Current APIFY_ACTOR_ID returned non-array dataset for competitor profile sync");
  }

  if (items.length === 0) return [];

  const fetchedAt = new Date().toISOString();

  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const imageUrls = collectImageUrls(item);
      const shortcode = firstString(item.shortCode, item.shortcode, item.code) || null;
      const caption = firstString(item.caption, item.text, item.description);
      const timestamp = toIsoDate(firstString(item.timestamp, item.takenAt, item.datetime, item.date) || item.timestamp);
      const postType = detectPostType(item, imageUrls);
      const likesCount = firstNumber(item.likesCount, item.likes, item.likeCount);
      const commentsCount = firstNumber(item.commentsCount, item.comments, item.commentCount);
      const videoViewCount = firstNumber(item.videoViewCount, item.videoViews, item.viewCount);
      const playCount = firstNumber(item.playCount, item.playsCount, item.videoPlayCount);
      const url = buildPostUrl(item, competitor.username, shortcode);
      const scoreInput = { postType, timestamp, likesCount, commentsCount, videoViewCount, playCount };
      const { score, scoreReason } = scoreInstagramPost(scoreInput);

      return {
        id: `${competitor.username}:${shortcode || url}`,
        competitorId: competitor.id,
        competitorUsername: competitor.username,
        url,
        shortcode,
        caption,
        postType,
        timestamp,
        likesCount,
        commentsCount,
        videoViewCount,
        playCount,
        imageUrls,
        thumbnailUrl: imageUrls[0] ?? null,
        score,
        scoreReason,
        fetchedAt,
      } satisfies InstagramRadarPost;
    });
}

export async function syncInstagramRadar(input: {
  windowDays: number;
  apifyToken: string;
  apifyActorId: string;
}): Promise<InstagramRadarSyncResult> {
  const competitors = (await readInstagramCompetitors()).filter((competitor) => competitor.active);
  const allPosts: InstagramRadarPost[] = [];
  const errors: string[] = [];

  for (const competitor of competitors) {
    try {
      const posts = await fetchRecentPostsForCompetitor({
        competitor,
        apifyToken: input.apifyToken,
        apifyActorId: input.apifyActorId,
      });
      allPosts.push(...posts);
    } catch (error) {
      errors.push(`${competitor.username}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (competitors.length > 0 && allPosts.length === 0 && errors.length > 0) {
    throw new Error(
      `Current APIFY_ACTOR_ID does not support competitor profile sync or returned no usable posts. Details: ${errors.join(" | ")}`
    );
  }

  const kept = filterRecentPosts(allPosts, input.windowDays, 500);
  await writeJsonAtomic(postsCacheFile, kept);
  await appendSyncLog({
    windowDays: input.windowDays,
    competitorsChecked: competitors.length,
    postsFound: allPosts.length,
    postsKept: kept.length,
    errors,
  });

  return {
    ok: true,
    windowDays: input.windowDays,
    competitorsChecked: competitors.length,
    postsFound: allPosts.length,
    postsKept: kept.length,
    posts: kept.sort((a, b) => b.score - a.score),
  };
}
