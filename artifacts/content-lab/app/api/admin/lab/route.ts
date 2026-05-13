import {
  getOrCreateContentSettings,
  listAllReferenceRows,
  listAllSources,
  replaceAllSources,
  replaceReferenceImages,
  updateContentSettings,
} from "@/lib/data/content-store";
import { z } from "zod";
import { NextResponse } from "next/server";

const postSchema = z.object({
  settings: z
    .object({
      brandPrompt: z.string().optional(),
      hardRules: z.string().optional(),
      autoPublish: z.boolean().optional(),
      lookbackDays: z.number().int().min(1).max(90).optional(),
      minPostChars: z.number().int().min(20).optional(),
      maxPostsPerSource: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
  sources: z
    .array(
      z.object({
        mode: z.enum(["competitor", "keyword"]),
        value: z.string().min(1),
        authorUsername: z.string().optional().nullable(),
      }),
    )
    .optional(),
  /** Reference image public URLs (https). */
  referenceImages: z
    .array(
      z.object({
        url: z
          .string()
          .min(8)
          .refine(
            (s) => s.startsWith("https://") || s.startsWith("http://"),
            "URL",
          ),
        isPrimary: z.boolean().optional(),
      }),
    )
    .optional(),
});

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getOrCreateContentSettings();
  const sources = await listAllSources();
  const refRows = await listAllReferenceRows();
  return NextResponse.json({ settings, sources, referenceImages: refRows });
}

export async function POST(req: Request) {
  const raw = await req.json();
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { settings, sources, referenceImages } = parsed.data;
  if (settings) {
    await updateContentSettings(settings);
  }
  if (sources) {
    await replaceAllSources(sources);
  }
  if (referenceImages) {
    await replaceReferenceImages(referenceImages);
  }
  return await GET();
}
