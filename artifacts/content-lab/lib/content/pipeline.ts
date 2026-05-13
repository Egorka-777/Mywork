import { buildImagePrompt } from "@/lib/ai/rewrite-helpers";
import type { Rewritten } from "@/lib/ai/rewrite";
import { generateSeedreamImage } from "@/lib/ai/seedream";
import {
  fetchCompetitorProfilePosts,
  fetchKeywordSearch,
  postWithinLookback,
  type CandidatePost,
} from "@/lib/threads/source";
import { publishThread } from "@/lib/threads/publish";
import { scorePercentile75, scorePost } from "@/lib/content/score";
import {
  cacheSourcePost,
  getActiveContentSources,
  getActiveReferenceImageUrls,
  getOrCreateContentSettings,
  hasRecentDuplicateText,
  insertPublishLog,
  markDraftError,
  markDraftPublished,
  saveDraftRow,
} from "@/lib/data/content-store";
import { rewritePost } from "@/lib/ai/rewrite";
import { isPublicHttpsUrl } from "@/lib/storage/public-media";

const MIN_CHARS = 80;

type Scored = CandidatePost & { _score: number; _group: string };

function filterWindowAndLength(
  posts: CandidatePost[],
  lookbackMaxDays: number,
  minChars: number,
) {
  return posts.filter(
    (p) =>
      p.text.length >= minChars && postWithinLookback(p, lookbackMaxDays),
  );
}

/**
 * For each group batch: keep posts with score >= p75 *within the batch*.
 */
function applyP75FromBatch(batch: Scored[]) {
  if (!batch.length) return [];
  const withScores: Scored[] = batch.map((p) => ({
    ...p,
    _score: p._score ?? scorePost(p),
  }));
  const scores = withScores.map((p) => p._score);
  const p75 = scorePercentile75(scores);
  return withScores.filter((p) => p._score >= p75);
}

export type PipelineResult =
  | { ok: true; mode: "skipped"; reason: string }
  | { ok: true; mode: "draft" | "published"; draftId: string; postId?: string; imageUrl: string }
  | { ok: false; error: string };

export async function runContentPipeline(): Promise<PipelineResult> {
  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  const threadsUserId = process.env.THREADS_USER_ID;
  if (!accessToken || !threadsUserId) {
    return {
      ok: false,
      error: "Set THREADS_ACCESS_TOKEN and THREADS_USER_ID",
    };
  }

  const settings = await getOrCreateContentSettings();
  const lookback = settings.lookbackDays;
  const minChars = settings.minPostChars ?? MIN_CHARS;
  const maxPer = settings.maxPostsPerSource ?? 20;

  const sources = await getActiveContentSources();
  if (!sources.length) {
    return { ok: true, mode: "skipped", reason: "no_content_sources" };
  }

  const refUrls = await getActiveReferenceImageUrls(6);
  if (!refUrls.length) {
    return { ok: true, mode: "skipped", reason: "no_reference_images" };
  }
  for (const u of refUrls) {
    if (!isPublicHttpsUrl(u)) {
      return {
        ok: false,
        error: `Reference URL must be public http(s): ${u}`,
      };
    }
  }

  const collected: Scored[] = [];

  for (const src of sources) {
    const mode = src.mode;
    if (mode === "competitor") {
      const un = src.value.replace(/^@+/, "");
      const group = `c:${un}`;
      let list: CandidatePost[] = [];
      try {
        list = await fetchCompetitorProfilePosts({
          threadsUserId,
          accessToken,
          username: un,
          limit: maxPer,
        });
      } catch (e) {
        return {
          ok: false,
          error: `competitor ${un}: ${e instanceof Error ? e.message : e}`,
        };
      }
      list = filterWindowAndLength(list, lookback, minChars);
      for (const p of list) {
        const sc = scorePost(p);
        collected.push({ ...p, _score: sc, _group: group });
      }
    } else if (mode === "keyword") {
      const group = `k:${src.value}${src.authorUsername ? `:${src.authorUsername}` : ""}`;
      let list: CandidatePost[] = [];
      try {
        list = await fetchKeywordSearch({
          accessToken,
          q: src.value,
          searchType: "TOP",
          authorUsername: src.authorUsername ?? undefined,
          limit: maxPer,
        });
      } catch (e) {
        return {
          ok: false,
          error: `keyword ${src.value}: ${e instanceof Error ? e.message : e}`,
        };
      }
      list = filterWindowAndLength(list, lookback, minChars);
      for (const p of list) {
        const sc = scorePost(p);
        collected.push({ ...p, _score: sc, _group: group });
      }
    }
  }

  const groups = [...new Set(collected.map((c) => c._group))];
  let p75pass: Scored[] = [];
  for (const g of groups) {
    const batch = collected.filter((c) => c._group === g);
    p75pass = p75pass.concat(applyP75FromBatch(batch));
  }

  p75pass.sort((a, b) => b._score - a._score);

  for (const candidate of p75pass) {
    if (await hasRecentDuplicateText(candidate.text, 30)) {
      continue;
    }
    // cache + process first non-duplicate
    const sourceKey = candidate._group;
    await cacheSourcePost({
      id: candidate.id,
      sourceKey,
      text: candidate.text,
      username: candidate.username,
      permalink: candidate.permalink,
      like_count: candidate.like_count,
      reply_count: candidate.reply_count,
      repost_count: candidate.repost_count,
      quote_count: candidate.quote_count,
      postedAt: candidate.timestamp,
    });

    const brandPrompt = settings.brandPrompt;
    if (!brandPrompt.trim()) {
      return { ok: false, error: "brandPrompt is empty in content_settings" };
    }

    let rewritten: Rewritten;
    try {
      rewritten = await rewritePost({
        sourceText: candidate.text,
        brandPrompt,
        hardRules: settings.hardRules ?? "",
      });
    } catch (e) {
      return { ok: false, error: `rewrite: ${e instanceof Error ? e.message : e}` };
    }

    const imagePrompt = buildImagePrompt(rewritten);

    let imageUrl: string;
    try {
      imageUrl = await generateSeedreamImage({
        prompt: imagePrompt,
        imageUrls: refUrls,
      });
    } catch (e) {
      return { ok: false, error: `seedream: ${e instanceof Error ? e.message : e}` };
    }

    const auto = settings.autoPublish;
    const status = auto ? "ready_to_publish" : "draft";
    const draft = await saveDraftRow({
      sourcePostId: candidate.id,
      sourceText: candidate.text,
      rewritten,
      imagePrompt,
      imageUrl,
      status,
    });

    if (!auto) {
      return {
        ok: true,
        mode: "draft",
        draftId: draft.id,
        imageUrl,
      };
    }

    if (!process.env.THREADS_USER_ID) {
      await markDraftError(draft.id, "THREADS_USER_ID missing");
      return { ok: false, error: "THREADS_USER_ID" };
    }

    try {
      const pub = await publishThread({
        threadsUserId: process.env.THREADS_USER_ID!,
        accessToken: process.env.THREADS_ACCESS_TOKEN!,
        text: rewritten.finalText,
        imageUrl,
      });
      await markDraftPublished(draft.id, pub.postId);
      await insertPublishLog(
        draft.id,
        true,
        "published",
        { postId: pub.postId, containerId: pub.containerId },
      );
      return {
        ok: true,
        mode: "published",
        draftId: draft.id,
        postId: pub.postId,
        imageUrl,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markDraftError(draft.id, msg);
      await insertPublishLog(draft.id, false, msg);
      return { ok: false, error: msg };
    }
  }

  return { ok: true, mode: "skipped", reason: "no_candidates" };
}
