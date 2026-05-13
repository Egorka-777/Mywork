import type { Rewritten } from "./rewrite";

export function buildImagePrompt(rewritten: Rewritten) {
  return [
    "Create a photorealistic Threads image.",
    "",
    "Main subject:",
    "the same person identity as in Figures 1-6.",
    "Preserve facial identity, age, skin tone, and overall recognizability.",
    "",
    "Scene goal:",
    rewritten.imageIdea,
    "",
    "Style:",
    "premium motivational editorial, realistic, clean, modern, high trust.",
    "",
    "Composition:",
    "single main subject, clear focal point, no text on image, visually strong for social post.",
    "",
    "Quality rules:",
    "realistic face, realistic hands, no extra fingers, no duplicate people, no distorted eyes, no oversaturated skin.",
  ]
    .join("\n")
    .trim();
}
