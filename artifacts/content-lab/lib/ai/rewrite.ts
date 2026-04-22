import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { z } from "zod";

const outSchema = z.object({
  hook: z.string(),
  body: z.string(),
  finalText: z.string(),
  imageIdea: z.string(),
  angle: z.string().optional(),
});

export type Rewritten = z.infer<typeof outSchema>;
export { outSchema as rewriteResultSchema };

function buildUserPrompt(
  sourceText: string,
  brandPrompt: string,
  hardRules: string,
) {
  return `Ты редактор для Threads.

Задача:
- взять только идею исходного поста;
- полностью переписать текст с нуля в моём стиле;
- не копировать уникальные фразы, структуру и ритм исходника;
- сохранить сильный хук в первой строке;
- уложиться в 350–500 символов;
- закончить мягким CTA;
- вернуть JSON.

Мой стиль:
${brandPrompt}

Жёсткие правила:
${hardRules || "без копипаста; без кавычек из оригинала; без хэштегов, если явно не попросил; без воды; без эмодзи, если не указано."}

Исходный пост:
${sourceText}

Верни ТОЛЬКО JSON, без markdown:
{
  "hook": "...",
  "body": "...",
  "finalText": "...",
  "imageIdea": "...",
  "angle": "..."
}`;
}

export async function rewritePost({
  sourceText,
  brandPrompt,
  hardRules = "",
}: {
  sourceText: string;
  brandPrompt: string;
  hardRules?: string;
}): Promise<Rewritten> {
  const userPrompt = buildUserPrompt(sourceText, brandPrompt, hardRules);

  if (process.env.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await openai.chat.completions.create({
      model: process.env.OPENAI_REWRITE_MODEL ?? "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    });
    const raw = r.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI: empty content");
    return outSchema.parse(JSON.parse(raw));
  }

  if (process.env.GEMINI_API_KEY) {
    const modelName = process.env.GEMINI_REWRITE_MODEL ?? "gemini-2.0-flash";
    const model = new GoogleGenerativeAI(
      process.env.GEMINI_API_KEY,
    ).getGenerativeModel({ model: modelName });
    const r = await model.generateContent(
      userPrompt + "\n\nReturn valid JSON only.",
    );
    const text = r.response.text();
    if (!text) throw new Error("Gemini: empty");
    const cleaned = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
    return outSchema.parse(JSON.parse(cleaned));
  }

  throw new Error("Set OPENAI_API_KEY or GEMINI_API_KEY for rewritePost()");
}
