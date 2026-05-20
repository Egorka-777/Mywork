import type { WorkflowArtifact, WorkflowArtifactType } from "./agentArtifacts";
import { hasArtifactType } from "./agentArtifacts";

export type TaskIntent = "create" | "remix" | "rewrite" | "analyze" | "replicate" | "extract" | "unknown";
export type OutputFormat = "carousel" | "post" | "text_post" | "lipsync" | "document" | "analysis" | "unknown";

export type NormalizedTaskCard = {
  intent: TaskIntent;
  outputFormat: OutputFormat;
  sourceTypes: WorkflowArtifactType[];
  cta?: string;
  missingFields: string[];
  confidence: "high" | "medium" | "low";
  shouldAskUser: boolean;
  suggestedQuestions: string[];
};

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function detectCta(text: string): string | undefined {
  const match = text.match(/(?:cta|стоп-слово|ключевое слово|кодовое слово)\s*[:：-]\s*([А-ЯA-Z0-9_\- ]{2,40})/i);
  return match?.[1]?.trim();
}

function detectIntent(text: string, artifacts: WorkflowArtifact[]): TaskIntent {
  const q = text.toLowerCase();
  if (/так(ую|ой|ое)?\s+же|как\s+здесь|как\s+тут|по\s+образцу/.test(q)) return "replicate";
  if (/ремикс|remix|переделай|адаптируй/.test(q) || hasArtifactType(artifacts, "instagram_carousel_analysis")) return "remix";
  if (/перепиши|рерайт|rewrite|уникализ/.test(q)) return "rewrite";
  if (/проанализ|анализ|разбери|оцени|аудит|проверь/.test(q) || hasArtifactType(artifacts, "instagram_profile_url") || hasArtifactType(artifacts, "instagram_profile_snapshot")) return "analyze";
  if (/извлеки|достань\s+текст|распознай|ocr|транскриб/.test(q)) return "extract";
  if (/сделай|создай|напиши|подготовь|собери/.test(q)) return "create";
  return "unknown";
}

function detectOutputFormat(text: string, artifacts: WorkflowArtifact[]): OutputFormat {
  const q = text.toLowerCase();
  if (/карусел|слайд/.test(q) || hasArtifactType(artifacts, "instagram_carousel_analysis")) return "carousel";
  if (/lipsync|липсинг|липсинк|говорящ|озвучк|аватар/.test(q)) return "lipsync";
  if (/pdf|документ|docx|word|презентац|pptx|таблиц|excel|xlsx|html/.test(q)) return "document";
  if (/текстов(ый|ой)\s+пост|только\s+текст|threads|telegram|телеграм/.test(q)) return "text_post";
  if (/пост|публикац|caption|подпись/.test(q)) return "post";
  if (/анализ|разбор|аудит|проверь|оцени/.test(q) || hasArtifactType(artifacts, "instagram_profile_url") || hasArtifactType(artifacts, "instagram_profile_snapshot")) return "analysis";
  return "unknown";
}

export function buildTaskCard(userRequest: string, artifacts: WorkflowArtifact[]): NormalizedTaskCard {
  const sourceTypes = uniq(artifacts.map((artifact) => artifact.type));
  const intent = detectIntent(userRequest, artifacts);
  const outputFormat = detectOutputFormat(userRequest, artifacts);
  const cta = detectCta(userRequest);
  const missingFields: string[] = [];
  const suggestedQuestions: string[] = [];

  if (intent === "unknown") {
    missingFields.push("intent");
    suggestedQuestions.push("Что сделать: создать, переделать, переписать, проанализировать или извлечь текст?");
  }
  if (outputFormat === "unknown") {
    missingFields.push("output_format");
    suggestedQuestions.push("Какой результат нужен: карусель, пост, текстовый пост, lipsync, документ или анализ?");
  }
  if ((intent === "replicate" || /так(ую|ой|ое)?\s+же|как\s+здесь|как\s+тут/i.test(userRequest)) && outputFormat === "unknown") {
    missingFields.push("replicate_scope");
    suggestedQuestions.push("Что повторять: структуру, стиль, смысл или всё вместе?");
  }
  if (outputFormat === "carousel" && !cta && /cta|коммент|ключев|кодовое|напиши/i.test(userRequest)) {
    missingFields.push("cta");
    suggestedQuestions.push("Какой CTA или ключевое слово поставить на финальный слайд?");
  }

  const shouldAskUser = missingFields.length > 0;
  const confidence = !shouldAskUser ? "high" : missingFields.length <= 2 ? "medium" : "low";
  return {
    intent,
    outputFormat,
    sourceTypes,
    cta,
    missingFields: uniq(missingFields),
    confidence,
    shouldAskUser,
    suggestedQuestions: uniq(suggestedQuestions).slice(0, 2),
  };
}

export function summarizeTaskCardForWorkflow(taskCard: NormalizedTaskCard | null): string {
  if (!taskCard) return "(none)";
  return [
    `intent: ${taskCard.intent}`,
    `outputFormat: ${taskCard.outputFormat}`,
    `sourceTypes: ${taskCard.sourceTypes.join(", ") || "none"}`,
    taskCard.cta ? `cta: ${taskCard.cta}` : "cta: not set",
    `confidence: ${taskCard.confidence}`,
    `shouldAskUser: ${taskCard.shouldAskUser}`,
    `missingFields: ${taskCard.missingFields.join(", ") || "none"}`,
    `suggestedQuestions: ${taskCard.suggestedQuestions.join(" | ") || "none"}`,
  ].join("\n");
}
