/** Web/Apify provider for Task Radar. Does not touch Instagram Radar. */

export type WebActorDiagnosis = {
  apifyApiPresent: boolean;
  apifyTokenPresent: boolean;
  apifyActorIdPresent: boolean;
  apifyWebActorIdPresent: boolean;
  actorId: string | null;
  actorName: string | null;
  actorPurpose: string | null;
  inputSchemaSummary: string | null;
  outputSchemaSummary: string | null;
  supportsGenericSearch: boolean;
  supportsDate: boolean;
  suitableForWebSearch: boolean;
  reason: string;
};

export type WebSearchItem = {
  source: "web";
  externalId: string | null;
  fingerprint: string;
  text: string;
  title: string | null;
  publishedAt: string | null;
  foundAt: string;
  dateUnknown: boolean;
  url: string | null;
  sourceTitle: string | null;
  sourceUsername: string | null;
  matchedKeyword: string;
  domain: string | null;
};

export type WebSearchResult = {
  ok: boolean;
  items: WebSearchItem[];
  warnings: string[];
  diagnosis: WebActorDiagnosis;
  error?: string;
};

function normalizeApifyActorId(actorId: string): string {
  const trimmed = actorId.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("/")) {
    const [user, name] = trimmed.split("/");
    return `${user}~${name}`;
  }
  return trimmed;
}

function envPresent(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function looksLikeInstagramActor(meta: {
  name?: string;
  title?: string;
  description?: string;
  inputKeys?: string[];
}): boolean {
  const blob = `${meta.name || ""} ${meta.title || ""} ${meta.description || ""}`.toLowerCase();
  if (blob.includes("instagram")) return true;
  const keys = new Set((meta.inputKeys || []).map((k) => k.toLowerCase()));
  if (keys.has("directurls") || keys.has("usernames") || keys.has("username")) {
    if (!keys.has("query") && !keys.has("search") && !keys.has("queries") && !keys.has("keyword")) {
      return true;
    }
  }
  return false;
}

function supportsGenericSearchFromInput(inputKeys: string[]): boolean {
  const keys = new Set(inputKeys.map((k) => k.toLowerCase()));
  return (
    keys.has("query") ||
    keys.has("queries") ||
    keys.has("search") ||
    keys.has("keyword") ||
    keys.has("keywords") ||
    keys.has("q")
  );
}

export async function diagnoseWebActor(): Promise<WebActorDiagnosis> {
  const apifyApiPresent = envPresent("APIFY_API");
  const apifyTokenPresent = envPresent("APIFY_TOKEN");
  const apifyActorIdPresent = envPresent("APIFY_ACTOR_ID");
  const apifyWebActorIdPresent = envPresent("APIFY_WEB_ACTOR_ID");

  const webActor = process.env.APIFY_WEB_ACTOR_ID?.trim() || "";
  const instagramActor = process.env.APIFY_ACTOR_ID?.trim() || "";
  const actorIdRaw = webActor || instagramActor || null;
  const token = process.env.APIFY_TOKEN?.trim() || "";

  const base: WebActorDiagnosis = {
    apifyApiPresent,
    apifyTokenPresent,
    apifyActorIdPresent,
    apifyWebActorIdPresent,
    actorId: actorIdRaw,
    actorName: null,
    actorPurpose: null,
    inputSchemaSummary: null,
    outputSchemaSummary: null,
    supportsGenericSearch: false,
    supportsDate: false,
    suitableForWebSearch: false,
    reason: "Apify web search is not configured",
  };

  if (!apifyTokenPresent) {
    return {
      ...base,
      reason: "APIFY_TOKEN missing — web search unavailable",
    };
  }

  if (!actorIdRaw) {
    return {
      ...base,
      reason: "No APIFY_WEB_ACTOR_ID or APIFY_ACTOR_ID configured",
    };
  }

  // Without a dedicated web actor, do not reuse the Instagram actor blindly.
  if (!apifyWebActorIdPresent) {
    // Codebase evidence: APIFY_ACTOR_ID feeds Instagram Radar profile sync (directUrls).
    return {
      ...base,
      actorId: instagramActor || null,
      actorName: "configured APIFY_ACTOR_ID (Instagram Radar)",
      actorPurpose: "Instagram competitor/profile posts (used by Instagram Radar)",
      inputSchemaSummary: "directUrls / profile URLs (from Instagram Radar usage)",
      outputSchemaSummary: "Instagram post objects with caption/url/timestamp",
      supportsGenericSearch: false,
      supportsDate: true,
      suitableForWebSearch: false,
      reason:
        "Интернет-поиск не настроен: текущий Apify Actor предназначен для Instagram. Задайте APIFY_WEB_ACTOR_ID для web-поиска.",
    };
  }

  try {
    const actorId = normalizeApifyActorId(webActor);
    const res = await fetch(`https://api.apify.com/v2/acts/${actorId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return {
        ...base,
        actorId: webActor,
        reason: `Failed to load APIFY_WEB_ACTOR_ID metadata: HTTP ${res.status}`,
      };
    }
    const payload = (await res.json()) as {
      data?: {
        name?: string;
        title?: string;
        description?: string;
        defaultRunOptions?: unknown;
        versions?: { versionNumber?: string }[];
      };
    };
    const data = payload.data || {};
    let inputKeys: string[] = [];
    try {
      const inputRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/input-schema`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (inputRes.ok) {
        const schema = (await inputRes.json()) as {
          properties?: Record<string, unknown>;
        };
        inputKeys = Object.keys(schema.properties || {});
      }
    } catch {
      // optional
    }

    const instagramOnly = looksLikeInstagramActor({
      name: data.name,
      title: data.title,
      description: data.description,
      inputKeys,
    });
    const generic = supportsGenericSearchFromInput(inputKeys) && !instagramOnly;

    return {
      ...base,
      actorId: webActor,
      actorName: data.title || data.name || webActor,
      actorPurpose: data.description?.slice(0, 240) || null,
      inputSchemaSummary: inputKeys.length ? inputKeys.slice(0, 20).join(", ") : null,
      outputSchemaSummary: "dataset items (inspected at runtime)",
      supportsGenericSearch: generic,
      supportsDate: true,
      suitableForWebSearch: generic,
      reason: generic
        ? "APIFY_WEB_ACTOR_ID looks suitable for generic search"
        : "APIFY_WEB_ACTOR_ID does not look like a generic web-search actor",
    };
  } catch (error) {
    return {
      ...base,
      actorId: webActor,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function pickString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeWebItem(
  raw: Record<string, unknown>,
  keyword: string,
  foundAt: string
): WebSearchItem | null {
  const url = pickString(raw, ["url", "link", "pageUrl", "websiteUrl"]);
  const title = pickString(raw, ["title", "name", "heading"]);
  const text =
    pickString(raw, ["text", "snippet", "description", "content", "body"]) || title;
  if (!text) return null;

  const publishedAt = pickString(raw, [
    "publishedAt",
    "date",
    "publishedDate",
    "createdAt",
    "timestamp",
  ]);
  const dateUnknown = !publishedAt;
  const externalId = pickString(raw, ["id", "externalId", "uid"]) || (url ? url : null);
  const fingerprint = url
    ? `web:${url}`
    : `web:${keyword}:${text.slice(0, 120)}:${publishedAt || "nodate"}`;

  return {
    source: "web",
    externalId,
    fingerprint,
    text,
    title,
    publishedAt,
    foundAt,
    dateUnknown,
    url,
    sourceTitle: title || domainFromUrl(url),
    sourceUsername: null,
    matchedKeyword: keyword,
    domain: domainFromUrl(url),
  };
}

export async function searchWebTasks(input: {
  keywords: string[];
  domains: string[];
  maxAgeMinutes: number;
  limitPerKeyword?: number;
}): Promise<WebSearchResult> {
  const diagnosis = await diagnoseWebActor();
  if (!diagnosis.suitableForWebSearch) {
    return {
      ok: false,
      items: [],
      warnings: [diagnosis.reason],
      diagnosis,
      error: "web_actor_unsuitable",
    };
  }

  const token = process.env.APIFY_TOKEN?.trim() || "";
  const actorRaw = process.env.APIFY_WEB_ACTOR_ID?.trim() || "";
  if (!token || !actorRaw) {
    return {
      ok: false,
      items: [],
      warnings: [diagnosis.reason],
      diagnosis,
      error: "web_not_configured",
    };
  }

  const actorId = normalizeApifyActorId(actorRaw);
  const foundAt = new Date().toISOString();
  const warnings: string[] = [];
  const items: WebSearchItem[] = [];
  const limit = Math.max(1, Math.min(input.limitPerKeyword ?? 20, 40));

  for (const keyword of input.keywords) {
    const queryParts = [keyword];
    if (input.domains.length) {
      queryParts.push(input.domains.map((d) => `site:${d}`).join(" OR "));
    }
    const query = queryParts.join(" ");
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=60`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            keywords: [keyword],
            search: query,
            maxItems: limit,
            maxAgeMinutes: input.maxAgeMinutes,
            domains: input.domains,
          }),
        }
      );
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        warnings.push(`Web search failed for «${keyword}»: HTTP ${res.status} ${detail}`);
        continue;
      }
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows)) {
        warnings.push(`Web actor returned non-array for «${keyword}»`);
        continue;
      }
      for (const row of rows.slice(0, limit)) {
        if (!row || typeof row !== "object") continue;
        const item = normalizeWebItem(row as Record<string, unknown>, keyword, foundAt);
        if (item) items.push(item);
      }
    } catch (error) {
      warnings.push(
        `Web search error for «${keyword}»: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    ok: true,
    items,
    warnings,
    diagnosis,
  };
}
