export type WorkflowArtifactType =
  | "plain_url"
  | "instagram_profile_url"
  | "instagram_post_url"
  | "instagram_carousel_analysis"
  | "instagram_profile_snapshot"
  | "extracted_source"
  | "style_reference"
  | "character_reference"
  | "tool_warning"
  | "unknown";

export type WorkflowArtifact = {
  id: string;
  type: WorkflowArtifactType;
  source: "user_request" | "manual" | "upload" | "tool";
  sourceUrl?: string;
  title: string;
  summary: string;
  textContent?: string;
  structuredData?: Record<string, unknown>;
  createdAt: string;
};

const URL_RE = /https?:\/\/[^\s)\]}>'"]+/gi;
const MAX_TEXT_CONTENT_LENGTH = 60_000;
const MAX_SUMMARY_LENGTH = 4_000;
const MAX_STRUCTURED_JSON_LENGTH = 60_000;

function cleanUrl(raw: string): string {
  return raw.trim().replace(/[.,;!?]+$/g, "");
}

function parseSafeUrl(raw: string): URL | null {
  try {
    return new URL(cleanUrl(raw));
  } catch {
    return null;
  }
}

export function isInstagramHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "instagram.com" || h === "www.instagram.com" || h === "m.instagram.com";
}

export function classifyUrl(rawUrl: string): WorkflowArtifactType {
  const url = parseSafeUrl(rawUrl);
  if (!url) return "unknown";
  if (!isInstagramHost(url.hostname)) return "plain_url";

  const path = url.pathname.toLowerCase().replace(/\/+$/g, "");
  if (/^\/(p|reel|tv)\//.test(path)) return "instagram_post_url";
  if (path && path !== "/" && !path.startsWith("/explore") && !path.startsWith("/accounts")) {
    return "instagram_profile_url";
  }
  return "plain_url";
}

export function extractUrlsFromText(text: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    const cleaned = cleanUrl(match[0]);
    if (parseSafeUrl(cleaned)) urls.add(cleaned);
  }
  return [...urls];
}

function titleForType(type: WorkflowArtifactType): string {
  switch (type) {
    case "instagram_profile_url":
      return "Instagram profile URL";
    case "instagram_post_url":
      return "Instagram post/reel URL";
    case "instagram_carousel_analysis":
      return "Instagram carousel analysis";
    case "instagram_profile_snapshot":
      return "Instagram profile snapshot";
    case "extracted_source":
      return "Extracted source file";
    case "style_reference":
      return "Style reference";
    case "character_reference":
      return "Character reference";
    case "tool_warning":
      return "Tool warning";
    case "plain_url":
      return "URL";
    default:
      return "Unknown URL";
  }
}

function summaryForUrl(type: WorkflowArtifactType, url: string): string {
  switch (type) {
    case "instagram_profile_url":
      return `Detected Instagram profile URL. Route this as profile/account analysis, not carousel generation: ${url}`;
    case "instagram_post_url":
      return `Detected Instagram post/reel URL. This can be processed by carousel import/analyze tools: ${url}`;
    case "plain_url":
      return `Detected generic URL: ${url}`;
    default:
      return `Detected URL with unknown type: ${url}`;
  }
}

const ALLOWED_ARTIFACT_TYPES: WorkflowArtifactType[] = [
  "plain_url",
  "instagram_profile_url",
  "instagram_post_url",
  "instagram_carousel_analysis",
  "instagram_profile_snapshot",
  "extracted_source",
  "style_reference",
  "character_reference",
  "tool_warning",
  "unknown",
];

function normalizeArtifactType(value: unknown): WorkflowArtifactType {
  return typeof value === "string" && ALLOWED_ARTIFACT_TYPES.includes(value as WorkflowArtifactType)
    ? (value as WorkflowArtifactType)
    : "unknown";
}

function normalizeArtifactSource(value: unknown): WorkflowArtifact["source"] {
  return value === "user_request" || value === "manual" || value === "upload" || value === "tool"
    ? value
    : "manual";
}

function safeStructuredData(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const json = JSON.stringify(value);
  if (json.length <= MAX_STRUCTURED_JSON_LENGTH) return value as Record<string, unknown>;
  return {
    truncated: true,
    originalJsonLength: json.length,
    preview: json.slice(0, MAX_STRUCTURED_JSON_LENGTH),
  };
}

function tryParseStructuredData(raw: string): Record<string, unknown> | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return safeStructuredData(parsed);
  } catch {
    return {
      parseWarning: "Embedded structuredData was not valid JSON after truncation or formatting.",
      preview: text.slice(0, MAX_STRUCTURED_JSON_LENGTH),
    };
  }
}

export function makeWorkflowArtifact(input: {
  id: string;
  type: WorkflowArtifactType;
  source: WorkflowArtifact["source"];
  title?: string;
  summary: string;
  sourceUrl?: string;
  textContent?: string;
  structuredData?: Record<string, unknown>;
  createdAt?: string;
}): WorkflowArtifact {
  const cleanSourceUrl = input.sourceUrl && parseSafeUrl(input.sourceUrl) ? cleanUrl(input.sourceUrl) : undefined;
  return {
    id: input.id.slice(0, 120),
    type: input.type,
    source: input.source,
    title: (input.title?.trim() || titleForType(input.type)).slice(0, 240),
    summary: input.summary.trim().slice(0, MAX_SUMMARY_LENGTH),
    sourceUrl: cleanSourceUrl,
    textContent: input.textContent?.slice(0, MAX_TEXT_CONTENT_LENGTH),
    structuredData: safeStructuredData(input.structuredData),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function readSingleLineField(block: string, field: string): string {
  const re = new RegExp(`^${field}:\\s*(.*)$`, "im");
  return block.match(re)?.[1]?.trim() ?? "";
}

function readMultilineField(block: string, field: "textContent" | "structuredData"): string {
  const startToken = `\n${field}:\n`;
  const start = block.indexOf(startToken);
  if (start === -1) return "";
  const contentStart = start + startToken.length;
  const nextText = field === "structuredData" ? -1 : block.indexOf("\nstructuredData:\n", contentStart);
  const nextArtifact = block.indexOf("\nARTIFACT:", contentStart);
  const stops = [nextText, nextArtifact].filter((n) => n !== -1);
  const end = stops.length > 0 ? Math.min(...stops) : block.length;
  return block.slice(contentStart, end).trim();
}

export function extractEmbeddedArtifactsFromText(text: string): WorkflowArtifact[] {
  if (!text.includes("ARTIFACT:")) return [];
  const parts = text.split(/\nARTIFACT:\s*/).slice(1);
  const artifacts: WorkflowArtifact[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const block = `ARTIFACT: ${parts[index]}`;
    const title = block.match(/^ARTIFACT:\s*(.*)$/m)?.[1]?.trim() || "Embedded artifact";
    const type = normalizeArtifactType(readSingleLineField(block, "type"));
    const source = normalizeArtifactSource(readSingleLineField(block, "source"));
    const sourceUrlRaw = readSingleLineField(block, "url");
    const sourceUrl = sourceUrlRaw && parseSafeUrl(sourceUrlRaw) ? cleanUrl(sourceUrlRaw) : undefined;
    const summary = readSingleLineField(block, "summary") || "Embedded artifact from Agents Hub prepared request.";
    const textContent = readMultilineField(block, "textContent");
    const structuredRaw = readMultilineField(block, "structuredData");

    artifacts.push(makeWorkflowArtifact({
      id: `embedded-artifact-${index + 1}`,
      type,
      source,
      sourceUrl,
      title,
      summary,
      textContent: textContent || undefined,
      structuredData: tryParseStructuredData(structuredRaw),
    }));
  }

  return artifacts;
}

export function buildArtifactsFromUserRequest(userRequest: string): WorkflowArtifact[] {
  const now = new Date().toISOString();
  const embeddedArtifacts = extractEmbeddedArtifactsFromText(userRequest);
  const embeddedUrls = new Set(embeddedArtifacts.map((artifact) => artifact.sourceUrl).filter((url): url is string => Boolean(url)));
  const urlArtifacts = extractUrlsFromText(userRequest)
    .filter((url) => !embeddedUrls.has(url))
    .map((url, index) => {
      const type = classifyUrl(url);
      return makeWorkflowArtifact({
        id: `request-url-${index + 1}`,
        type,
        source: "user_request",
        sourceUrl: url,
        summary: summaryForUrl(type, url),
        structuredData: {
          url,
          type,
        },
        createdAt: now,
      });
    });

  return [...embeddedArtifacts, ...urlArtifacts];
}

export function sanitizeWorkflowArtifacts(input: unknown): WorkflowArtifact[] {
  if (!Array.isArray(input)) return [];
  const now = new Date().toISOString();
  return input
    .map((item, index): WorkflowArtifact | null => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const type = normalizeArtifactType(raw.type);
      const source = normalizeArtifactSource(raw.source);
      const sourceUrl = typeof raw.sourceUrl === "string" && parseSafeUrl(raw.sourceUrl) ? cleanUrl(raw.sourceUrl) : undefined;
      const fallbackId = `${source}-${type}-${index + 1}`;
      return makeWorkflowArtifact({
        id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId,
        type,
        source,
        sourceUrl,
        title: typeof raw.title === "string" ? raw.title : undefined,
        summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary : "No summary provided.",
        textContent: typeof raw.textContent === "string" ? raw.textContent : undefined,
        structuredData: safeStructuredData(raw.structuredData),
        createdAt: typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt : now,
      });
    })
    .filter((artifact): artifact is WorkflowArtifact => artifact !== null);
}

export function mergeWorkflowArtifacts(requestArtifacts: WorkflowArtifact[], providedArtifacts: WorkflowArtifact[]): WorkflowArtifact[] {
  const providedUrls = new Set(providedArtifacts.map((artifact) => artifact.sourceUrl).filter((url): url is string => Boolean(url)));
  const filteredRequestArtifacts = requestArtifacts.filter((artifact) => !artifact.sourceUrl || !providedUrls.has(artifact.sourceUrl));
  return [...filteredRequestArtifacts, ...providedArtifacts];
}

export function summarizeArtifactsForWorkflow(artifacts: WorkflowArtifact[]): string {
  if (artifacts.length === 0) return "(none)";
  return artifacts
    .map((artifact, index) => {
      const lines = [
        `${index + 1}. ${artifact.title}`,
        `type: ${artifact.type}`,
        `source: ${artifact.source}`,
      ];
      if (artifact.sourceUrl) lines.push(`url: ${artifact.sourceUrl}`);
      lines.push(`summary: ${artifact.summary}`);
      if (artifact.textContent?.trim()) lines.push(`text: ${artifact.textContent.slice(0, 12_000)}`);
      if (artifact.structuredData) lines.push(`structuredData: ${JSON.stringify(artifact.structuredData, null, 2).slice(0, 12_000)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function hasArtifactType(artifacts: WorkflowArtifact[], type: WorkflowArtifactType): boolean {
  return artifacts.some((artifact) => artifact.type === type);
}
