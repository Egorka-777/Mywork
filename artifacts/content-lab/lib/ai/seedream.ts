import { fal } from "@fal-ai/client";

export async function generateSeedreamImage(input: {
  prompt: string;
  imageUrls: string[];
}) {
  const imageUrls = input.imageUrls.filter(Boolean).slice(-10);

  if (!imageUrls.length) {
    throw new Error("No reference images provided");
  }

  if (!process.env.FAL_KEY) {
    throw new Error("FAL_KEY is not set");
  }

  fal.config({
    credentials: process.env.FAL_KEY,
  });

  const result = await fal.subscribe("fal-ai/bytedance/seedream/v4.5/edit", {
    input: {
      prompt: input.prompt,
      image_urls: imageUrls,
      image_size: "auto_4K",
      num_images: 1,
      max_images: 1,
      enable_safety_checker: true,
    },
    logs: true,
  });

  const imageUrl = result.data?.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error("Seedream returned no image");
  }

  return imageUrl;
}
