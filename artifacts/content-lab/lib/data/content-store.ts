import { desc, eq, gte, sql } from "drizzle-orm";
import {
  contentSettings,
  contentSources,
  getDb,
  generatedDrafts,
  publishLogs,
  referenceImages,
  sourcePosts,
} from "@workspace/db";
import type { Rewritten } from "@/lib/ai/rewrite";

export async function getOrCreateContentSettings() {
  const row = await getDb().select().from(contentSettings).limit(1);
  if (row[0]) return row[0];
  const [ins] = await getDb()
    .insert(contentSettings)
    .values({
      brandPrompt: "",
      hardRules: "",
    })
    .returning();
  if (!ins) throw new Error("Could not create content_settings");
  return ins;
}

export async function updateContentSettings(
  v: Partial<{
    brandPrompt: string;
    hardRules: string;
    autoPublish: boolean;
    lookbackDays: number;
    minPostChars: number;
    maxPostsPerSource: number;
  }>,
) {
  const cur = await getOrCreateContentSettings();
  const [row] = await getDb()
    .update(contentSettings)
    .set({
      ...v,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(contentSettings.id, cur.id))
    .returning();
  return row;
}

export async function replaceAllSources(
  sources: { mode: string; value: string; authorUsername?: string | null }[],
) {
  await getDb().delete(contentSources);
  if (!sources.length) return [];
  return await getDb()
    .insert(contentSources)
    .values(
      sources.map((s) => ({
        mode: s.mode,
        value: s.value,
        authorUsername: s.authorUsername ?? null,
        isActive: true,
      })),
    )
    .returning();
}

export async function replaceReferenceImages(
  urls: { url: string; isPrimary?: boolean }[],
) {
  await getDb().delete(referenceImages);
  if (!urls.length) return [];
  return await getDb()
    .insert(referenceImages)
    .values(
      urls.map((r, i) => ({
        url: r.url,
        isActive: true,
        isPrimary: r.isPrimary ?? false,
        sortOrder: i,
      })),
    )
    .returning();
}

export async function listAllSources() {
  return await getDb().select().from(contentSources);
}

export async function listAllReferenceRows() {
  return await getDb().select().from(referenceImages);
}

export async function getActiveContentSources() {
  return await getDb()
    .select()
    .from(contentSources)
    .where(eq(contentSources.isActive, true));
}

export async function getActiveReferenceImageUrls(limit = 6) {
  const rows = await getDb()
    .select()
    .from(referenceImages)
    .where(eq(referenceImages.isActive, true))
    .orderBy(
      desc(referenceImages.isPrimary),
      referenceImages.sortOrder,
      desc(referenceImages.id),
    );
  return rows
    .map((r) => r.url)
    .filter((u) => u.startsWith("https://") || u.startsWith("http://"))
    .slice(0, limit);
}

export async function cacheSourcePost(p: {
  id: string;
  sourceKey: string;
  text: string;
  username?: string;
  permalink?: string;
  like_count?: number;
  reply_count?: number;
  repost_count?: number;
  quote_count?: number;
  postedAt?: string;
  raw?: Record<string, unknown>;
}) {
  await getDb()
    .insert(sourcePosts)
    .values({
      id: p.id,
      sourceKey: p.sourceKey,
      text: p.text,
      username: p.username,
      permalink: p.permalink,
      likeCount: p.like_count ?? 0,
      replyCount: p.reply_count ?? 0,
      repostCount: p.repost_count ?? 0,
      quoteCount: p.quote_count ?? 0,
      postedAt: p.postedAt,
      raw: p.raw,
    })
    .onConflictDoUpdate({
      target: sourcePosts.id,
      set: {
        text: p.text,
        likeCount: p.like_count ?? 0,
        fetchedAt: sql`now()`,
        raw: p.raw,
      },
    });
}

function normalizeBody(t: string) {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function hasRecentDuplicateText(
  text: string,
  lookbackDays: number,
) {
  const norm = normalizeBody(text);
  if (!norm) return false;
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - lookbackDays);
  const minIso = minDate.toISOString();
  const recent = await getDb()
    .select({ sourceText: generatedDrafts.sourceText })
    .from(generatedDrafts)
    .where(gte(generatedDrafts.createdAt, minIso))
    .orderBy(desc(generatedDrafts.createdAt))
    .limit(200);
  return recent.some(
    (r) => r.sourceText && normalizeBody(r.sourceText) === norm,
  );
}

export async function saveDraftRow(input: {
  sourcePostId: string;
  sourceText: string;
  rewritten: Rewritten;
  imagePrompt: string;
  imageUrl: string;
  status: "draft" | "ready_to_publish" | "published" | "error";
}) {
  const [row] = await getDb()
    .insert(generatedDrafts)
    .values({
      sourcePostId: input.sourcePostId,
      sourceText: input.sourceText,
      rewrittenText: input.rewritten.finalText,
      hook: input.rewritten.hook,
      body: input.rewritten.body,
      imageIdea: input.rewritten.imageIdea,
      imagePrompt: input.imagePrompt,
      imageUrl: input.imageUrl,
      status: input.status,
      rewriteJson: input.rewritten as unknown as Record<string, unknown>,
    })
    .returning();
  if (!row) throw new Error("insert draft failed");
  return row;
}

export async function markDraftPublished(
  draftId: string,
  threadsPostId: string,
) {
  const now = new Date().toISOString();
  await getDb()
    .update(generatedDrafts)
    .set({
      status: "published",
      publishedAt: now,
      publishedThreadsPostId: threadsPostId,
    })
    .where(eq(generatedDrafts.id, draftId));
}

export async function markDraftError(draftId: string, message: string) {
  await getDb()
    .update(generatedDrafts)
    .set({ status: "error", errorMessage: message })
    .where(eq(generatedDrafts.id, draftId));
}

export async function insertPublishLog(
  draftId: string,
  ok: boolean,
  message: string,
  raw?: Record<string, unknown>,
) {
  await getDb().insert(publishLogs).values({
    draftId,
    ok,
    message,
    raw,
  });
}
