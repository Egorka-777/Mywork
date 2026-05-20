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
  return {
    id: input.id,
    type: input.type,
    source: input.source,
    title: input.title ?? titleForType(input.type),
    summary: input.summary,
    sourceUrl: input.sourceUrl,
    textContent: input.textContent,
    structuredData: input.structuredData,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function buildArtifactsFromUserRequest(userRequest: string): WorkflowArtifact[] {
  const now = new Date().toISOString();
  return extractUrlsFromText(userRequest).map((url, index) => {
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
      if (artifact.textContent?.trim()) lines.push(`text: ${artifact.textContent.slice(0, 12000)}`);
      if (artifact.structuredData) lines.push(`structuredData: ${JSON.stringify(artifact.structuredData).slice(0, 12000)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function hasArtifactType(artifacts: WorkflowArtifact[], type: WorkflowArtifactType): boolean {
  return artifacts.some((artifact) => artifact.type === type);
}
