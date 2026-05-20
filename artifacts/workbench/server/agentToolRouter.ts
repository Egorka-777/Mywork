import crypto from "node:crypto";
import path from "node:path";
import type OpenAI from "openai";
import type { Express } from "express";
import {
  classifyUrl,
  makeWorkflowArtifact,
  type WorkflowArtifact,
} from "./agentArtifacts";
import { ExtractError, extractSourceFromUpload, SOURCE_REWRITER_ALLOWED_EXT } from "./sourceRewriter";

export type WorkflowToolRouterInput = {
  openrouter: OpenAI;
  visionModel: string;
  textModel: string;
  hasOpenRouter: boolean;
  groqApiKey?: string;
  apifyToken?: string;
  apifyActorId?: string;
  initialArtifacts: WorkflowArtifact[];
  sourceFiles?: Express.Multer.File[];
  styleReferenceFiles?: Express.Multer.File[];
  characterReferenceFile?: Express.Multer.File | null;
};

type CarouselImportResult = {
  ok: true;
  sourceUrl: string;
  caption: string;
  slides: { slideIndex: number; imageUrl: string; type: "image" }[];
  rawProvider: "apify";
};

function normalizeApifyActorId(actorId: string) {
  return actorId.includes("/") ? actorId.replace("/", "~") : actorId;
}

function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function collectImageUrls(item: Record<string, unknown>) {
  const urls: string[] = [];
  const pushUrl = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//.test(value)) urls.push(value);
  };
  pushUrl(item.displayUrl);
  pushUrl(item.imageUrl);
  if (Array.isArray(item.images)) item.images.forEach(pushUrl);
  const childPosts = item.childPosts;
  if (Array.isArray(childPosts)) {
    childPosts.forEach((child) => {
      if (child && typeof child === "object") {
        const c = child as Record<string, unknown>;
        pushUrl(c.displayUrl);
        pushUrl(c.imageUrl);
      }
    });
  }
  const carouselMedia = item.carouselMedia;
  if (Array.isArray(carouselMedia)) {
    carouselMedia.forEach((media) => {
      if (media && typeof media === "object") {
        const m = media as Record<string, unknown>;
        pushUrl(m.displayUrl);
        pushUrl(m.imageUrl);
      }
    });
  }
  return Array.from(new Set(urls));
}

async function imageUrlToDataUrl(imageUrl: string) {
  const r = await fetch(imageUrl);
  if (!r.ok) throw new Error(`Failed to fetch image: ${r.status}`);
  const contentType = r.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await r.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function importInstagramPost(url: string, apifyToken: string, apifyActorId: string): Promise<CarouselImportResult> {
  const actorId = normalizeApifyActorId(apifyActorId.trim());
  const apifyUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`;
  const input = {
    resultsType: "posts",
    directUrls: [url.trim()],
    resultsLimit: 1,
    searchType: "hashtag",
    searchLimit: 1,
    addParentData: false,
  };

  const apifyRes = await fetch(apifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apifyToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!apifyRes.ok) {
    const detail = await apifyRes.text().catch(() => "");
    throw new Error(`Apify request failed: ${apifyRes.status} ${apifyRes.statusText} ${detail.slice(0, 300)}`);
  }

  const items = (await apifyRes.json()) as Record<string, unknown>[];
  if (!Array.isArray(items) || items.length === 0) throw new Error("No carousel images found in provider response");
  const item = items[0];
  const caption = pickFirstString(item.caption, item.text, item.description);
  const imageUrls = collectImageUrls(item);
  if (imageUrls.length === 0) throw new Error("No carousel images found in provider response");
  return {
    ok: true,
    sourceUrl: url.trim(),
    caption,
    slides: imageUrls.map((imageUrl, i) => ({ slideIndex: i + 1, imageUrl, type: "image" as const })),
    rawProvider: "apify",
  };
}

async function analyzeInstagramSlides(openrouter: OpenAI, visionModel: string, input: CarouselImportResult) {
  const dataUrls = await Promise.all(input.slides.map((slide) => imageUrlToDataUrl(slide.imageUrl)));
  const prompt = `Analyze these Instagram carousel slides and the post caption.\n\nCaption:\n"""\n${input.caption}\n"""\n\nFor each slide return: slideIndex, originalText, visualDescription, hasFace, hasScreenshot, hasText, slideRole, mentionedPeople, mentionedBrands, mentionedTools, mentionedPlatforms, visualElements, screenshotDescription, promptVisualHints, preserveNotes, generationPrompt.\n\nReturn JSON with exact shape:\n{\n  "slides": [],\n  "captionSummary": "",\n  "sourceContentAngle": ""\n}\n\nThe number of slides in JSON must equal the number of input images. Return only valid JSON. No markdown.`;
  const content: unknown[] = [
    { type: "text", text: prompt },
    ...dataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  const completion = await openrouter.chat.completions.create({
    model: visionModel,
    max_tokens: 4000,
    messages: [
      {
        role: "system",
        content: "You analyze Instagram carousel slides for transformative content remixing. Extract OCR text, visual elements, screenshots, faces, brands, tools and structure. Return only valid JSON.",
      },
      { role: "user", content } as Parameters<typeof openrouter.chat.completions.create>[0]["messages"][0],
    ],
  });
  const rawText = completion.choices[0]?.message?.content ?? "";
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { slides?: unknown[]; captionSummary?: string; sourceContentAngle?: string };
  if (!Array.isArray(parsed.slides) || parsed.slides.length !== dataUrls.length) {
    throw new Error(`Invalid carousel analysis response: ${rawText.slice(0, 500)}`);
  }
  return parsed;
}

function sourceFileSummary(file: Express.Multer.File): string {
  return `${file.originalname || "upload"} (${file.mimetype || "unknown"}, ${file.size} bytes)`;
}

async function extractUploadArtifact(input: WorkflowToolRouterInput, file: Express.Multer.File, index: number): Promise<WorkflowArtifact> {
  const extracted = await extractSourceFromUpload(input.openrouter, {
    visionModel: input.visionModel,
    hasOpenRouter: input.hasOpenRouter,
    groqApiKey: input.groqApiKey,
  }, file);
  return makeWorkflowArtifact({
    id: `source-file-${index + 1}-${crypto.randomUUID()}`,
    type: "extracted_source",
    source: "upload",
    title: `Extracted source: ${file.originalname || "upload"}`,
    summary: `Source file extracted through Source Rewriter. File: ${sourceFileSummary(file)}. Type: ${extracted.fileType}. Warnings: ${extracted.extractionWarnings.join("; ") || "none"}`,
    textContent: [extracted.fullRawText, extracted.transcript].filter(Boolean).join("\n\n"),
    structuredData: { extractedSource: extracted },
  });
}

async function referenceArtifact(input: WorkflowToolRouterInput, file: Express.Multer.File, type: "style_reference" | "character_reference", index: number): Promise<WorkflowArtifact> {
  let extracted: unknown = null;
  let textContent = "";
  try {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (SOURCE_REWRITER_ALLOWED_EXT.has(ext)) {
      extracted = await extractSourceFromUpload(input.openrouter, {
        visionModel: input.visionModel,
        hasOpenRouter: input.hasOpenRouter,
        groqApiKey: input.groqApiKey,
      }, file);
      const maybe = extracted as { fullRawText?: string; transcript?: string };
      textContent = [maybe.fullRawText, maybe.transcript].filter(Boolean).join("\n\n");
    }
  } catch (e) {
    extracted = { warning: e instanceof Error ? e.message : String(e) };
  }
  return makeWorkflowArtifact({
    id: `${type}-${index + 1}-${crypto.randomUUID()}`,
    type,
    source: "upload",
    title: type === "style_reference" ? `Style reference: ${file.originalname || "image"}` : `Character reference: ${file.originalname || "image"}`,
    summary: type === "style_reference"
      ? `User attached a style reference image/file. Use it as visual direction if the final output needs design prompts. File: ${sourceFileSummary(file)}`
      : `User attached a character/avatar reference. Use it only when a person/avatar is needed. File: ${sourceFileSummary(file)}`,
    textContent,
    structuredData: { fileName: file.originalname, mimeType: file.mimetype, size: file.size, extracted },
  });
}

async function processInstagramArtifact(input: WorkflowToolRouterInput, artifact: WorkflowArtifact): Promise<WorkflowArtifact[]> {
  if (artifact.type !== "instagram_post_url" || !artifact.sourceUrl) return [];
  if (!input.apifyToken || !input.apifyActorId) {
    return [makeWorkflowArtifact({
      id: `tool-warning-${crypto.randomUUID()}`,
      type: "tool_warning",
      source: "tool",
      sourceUrl: artifact.sourceUrl,
      title: "Instagram import unavailable",
      summary: "Instagram post URL detected, but APIFY_TOKEN or APIFY_ACTOR_ID is not configured. Agents will not see slide OCR until provider credentials are configured.",
    })];
  }
  if (!input.hasOpenRouter) {
    return [makeWorkflowArtifact({
      id: `tool-warning-${crypto.randomUUID()}`,
      type: "tool_warning",
      source: "tool",
      sourceUrl: artifact.sourceUrl,
      title: "Carousel analysis unavailable",
      summary: "Instagram post was detected, but OPENROUTER_API_KEY is not configured. Slide analysis/OCR cannot run.",
    })];
  }
  try {
    const imported = await importInstagramPost(artifact.sourceUrl, input.apifyToken, input.apifyActorId);
    const analysis = await analyzeInstagramSlides(input.openrouter, input.visionModel, imported);
    const slideText = (analysis.slides ?? [])
      .map((slide, i) => {
        const o = slide && typeof slide === "object" ? (slide as Record<string, unknown>) : {};
        return `Slide ${i + 1}: ${typeof o.originalText === "string" ? o.originalText : ""}\nVisual: ${typeof o.visualDescription === "string" ? o.visualDescription : ""}`;
      })
      .join("\n\n");
    return [makeWorkflowArtifact({
      id: `instagram-carousel-analysis-${crypto.randomUUID()}`,
      type: "instagram_carousel_analysis",
      source: "tool",
      sourceUrl: artifact.sourceUrl,
      title: "Imported Instagram carousel/post analysis",
      summary: `Instagram post imported and analyzed. Slides: ${imported.slides.length}. Caption summary: ${analysis.captionSummary ?? ""}`,
      textContent: [slideText, imported.caption ? `Caption:\n${imported.caption}` : ""].filter(Boolean).join("\n\n"),
      structuredData: { imported, analysis },
    })];
  } catch (e) {
    return [makeWorkflowArtifact({
      id: `tool-warning-${crypto.randomUUID()}`,
      type: "tool_warning",
      source: "tool",
      sourceUrl: artifact.sourceUrl,
      title: "Instagram import/analyze failed",
      summary: e instanceof Error ? e.message : String(e),
    })];
  }
}

export async function processWorkflowArtifacts(input: WorkflowToolRouterInput): Promise<WorkflowArtifact[]> {
  const generated: WorkflowArtifact[] = [];

  for (let i = 0; i < (input.sourceFiles ?? []).length; i += 1) {
    const file = input.sourceFiles![i];
    try {
      generated.push(await extractUploadArtifact(input, file, i));
    } catch (e) {
      if (e instanceof ExtractError) {
        generated.push(makeWorkflowArtifact({
          id: `tool-warning-${crypto.randomUUID()}`,
          type: "tool_warning",
          source: "tool",
          title: `Source extraction failed: ${file.originalname || "upload"}`,
          summary: JSON.stringify(e.body),
        }));
      } else {
        generated.push(makeWorkflowArtifact({
          id: `tool-warning-${crypto.randomUUID()}`,
          type: "tool_warning",
          source: "tool",
          title: `Source extraction failed: ${file.originalname || "upload"}`,
          summary: e instanceof Error ? e.message : String(e),
        }));
      }
    }
  }

  for (let i = 0; i < (input.styleReferenceFiles ?? []).length; i += 1) {
    generated.push(await referenceArtifact(input, input.styleReferenceFiles![i], "style_reference", i));
  }

  if (input.characterReferenceFile) {
    generated.push(await referenceArtifact(input, input.characterReferenceFile, "character_reference", 0));
  }

  const initial = input.initialArtifacts ?? [];
  for (const artifact of initial) {
    const type = artifact.sourceUrl ? classifyUrl(artifact.sourceUrl) : artifact.type;
    if (type === "instagram_post_url") {
      generated.push(...await processInstagramArtifact(input, { ...artifact, type: "instagram_post_url" }));
    }
    if (type === "instagram_profile_url") {
      generated.push(makeWorkflowArtifact({
        id: `instagram-profile-snapshot-${crypto.randomUUID()}`,
        type: "instagram_profile_snapshot",
        source: "tool",
        sourceUrl: artifact.sourceUrl,
        title: "Instagram profile detected",
        summary: "Instagram profile URL detected. Profile scraper is not connected in this codebase, so bio/posts/metrics are not extracted. Agents must not invent account data.",
        structuredData: { sourceArtifact: artifact },
      }));
    }
  }

  return generated;
}
