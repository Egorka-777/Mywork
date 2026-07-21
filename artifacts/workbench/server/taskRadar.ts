/** Task Radar owner: settings/items store + Telegram proxy + web merge. */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { diagnoseWebActor, searchWebTasks, type WebActorDiagnosis } from "./taskRadarWeb";

export type ReplyMode = "off" | "draft" | "auto";
export type AutoEnvironment = "test" | "live";
export type TaskRadarItemStatus = "new" | "opened" | "replied" | "ignored";
export type TaskRadarSource = "telegram" | "web";

export type TaskRadarSettings = {
  keywords: string[];
  excludeKeywords: string[];
  maxAgeMinutes: number;
  telegramEnabled: boolean;
  webEnabled: boolean;
  replyMode: ReplyMode;
  replyTemplate: string;
  autoEnvironment: AutoEnvironment;
  maxAutoPerHour: number;
  maxAutoPerDay: number;
  webDomains: string[];
  autoLiveConfirmed: boolean;
  autoDisabledReason: string | null;
};

export type TaskRadarItem = {
  id: string;
  source: TaskRadarSource;
  externalId: string | null;
  fingerprint: string;
  text: string;
  title?: string | null;
  publishedAt: string | null;
  foundAt: string;
  dateUnknown: boolean;
  chatId?: string | null;
  sourceTitle: string | null;
  sourceUsername: string | null;
  senderId?: string | null;
  senderUsername?: string | null;
  url: string | null;
  matchedKeyword: string;
  status: TaskRadarItemStatus;
  domain?: string | null;
  repliedAt?: string | null;
};

export type TaskRadarSearchStats = {
  keywordsChecked: number;
  rawFound: number;
  kept: number;
  duplicates: number;
  excluded: number;
  telegramKept: number;
  webKept: number;
};

const DEFAULT_REPLY_TEMPLATE =
  "Здравствуйте. Увидел ваш свежий пост по задаче. Могу посмотреть и взять в работу. Пришлите исходники и пример результата — быстро скажу по сроку и цене.";

const DEFAULT_KEYWORDS = [
  "нужен дизайнер",
  "ищу дизайнера",
  "кто сделает карточки товара",
  "нужна инфографика",
  "нужно оформить карточки",
  "ищу монтажера",
  "нужен монтаж ролика",
  "нужен таргетолог",
  "кто настроит рекламу",
  "нужен лендинг",
  "кто сделает сайт",
  "нужна презентация",
  "нужно оформить сообщество",
  "нужен AI ролик",
  "нужно сделать видео",
];

const DEFAULT_EXCLUDE = [
  "предлагаю услуги",
  "обучение",
  "курс",
  "резюме",
  "ищу работу",
  "вакансия в штат",
];

const DEFAULT_DOMAINS = ["kwork.ru", "freelance.ru", "fl.ru", "youdo.com", "avito.ru"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workbenchRoot = path.resolve(__dirname, "..");
const radarDir = path.join(workbenchRoot, "data", "task-radar");
const settingsFile = path.join(radarDir, "settings.json");
const itemsFile = path.join(radarDir, "items.json");
const runsFile = path.join(radarDir, "runs.jsonl");
const repliesFile = path.join(radarDir, "replies.jsonl");

const TELEGRAM_API_BASE =
  process.env.TASK_RADAR_TELEGRAM_URL?.trim() ||
  `http://127.0.0.1:${process.env.TASK_RADAR_TELEGRAM_PORT || "8792"}`;

function defaultSettings(): TaskRadarSettings {
  return {
    keywords: [...DEFAULT_KEYWORDS],
    excludeKeywords: [...DEFAULT_EXCLUDE],
    maxAgeMinutes: 180,
    telegramEnabled: true,
    webEnabled: true,
    replyMode: "draft",
    replyTemplate: DEFAULT_REPLY_TEMPLATE,
    autoEnvironment: "test",
    maxAutoPerHour: 5,
    maxAutoPerDay: 20,
    webDomains: [...DEFAULT_DOMAINS],
    autoLiveConfirmed: false,
    autoDisabledReason: null,
  };
}

async function ensureDir() {
  await fs.mkdir(radarDir, { recursive: true });
}

async function backupMalformedJson(filePath: string, raw: string) {
  const backupPath = `${filePath}.malformed.${Date.now()}.bak`;
  await fs.writeFile(backupPath, raw, "utf-8");
  await fs.unlink(filePath).catch((error) => {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  });
  console.error(`[task-radar] malformed JSON moved to ${backupPath}`);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      if (error instanceof SyntaxError) {
        await backupMalformedJson(filePath, raw);
        return fallback;
      }
      throw error;
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await ensureDir();
  const tmp = `${filePath}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

async function appendJsonl(filePath: string, record: unknown) {
  await ensureDir();
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf-8");
}

export async function readTaskRadarSettings(): Promise<TaskRadarSettings> {
  const stored = await readJsonFile<Partial<TaskRadarSettings>>(settingsFile, {});
  return { ...defaultSettings(), ...stored };
}

export async function saveTaskRadarSettings(
  patch: Partial<TaskRadarSettings>
): Promise<TaskRadarSettings> {
  const current = await readTaskRadarSettings();
  const next: TaskRadarSettings = {
    ...current,
    ...patch,
    keywords: Array.isArray(patch.keywords) ? patch.keywords.map(String) : current.keywords,
    excludeKeywords: Array.isArray(patch.excludeKeywords)
      ? patch.excludeKeywords.map(String)
      : current.excludeKeywords,
    webDomains: Array.isArray(patch.webDomains) ? patch.webDomains.map(String) : current.webDomains,
  };

  if (patch.replyMode === "auto" && next.autoEnvironment === "live" && !next.autoLiveConfirmed) {
    throw new Error("AUTO LIVE requires autoLiveConfirmed=true");
  }

  if (patch.replyMode && patch.replyMode !== "off") {
    next.autoDisabledReason = null;
  }

  await writeJsonAtomic(settingsFile, next);
  return next;
}

export async function readTaskRadarItems(): Promise<TaskRadarItem[]> {
  const items = await readJsonFile<TaskRadarItem[]>(itemsFile, []);
  return Array.isArray(items) ? items : [];
}

async function saveItems(items: TaskRadarItem[]) {
  await writeJsonAtomic(itemsFile, items);
}

function normalizeNeedle(value: string) {
  return value.trim().toLowerCase();
}

function containsExclude(text: string, excludes: string[]): boolean {
  const hay = normalizeNeedle(text);
  return excludes.some((ex) => {
    const n = normalizeNeedle(ex);
    return n && hay.includes(n);
  });
}

export function renderReplyTemplate(
  template: string,
  item: Pick<TaskRadarItem, "matchedKeyword" | "sourceTitle" | "sourceUsername" | "url">
): string {
  const source = item.sourceTitle || item.sourceUsername || "источник";
  return template
    .replaceAll("{{keyword}}", item.matchedKeyword || "")
    .replaceAll("{{source}}", source)
    .replaceAll("{{url}}", item.url || "");
}

function sortItems(items: TaskRadarItem[]): TaskRadarItem[] {
  return [...items].sort((a, b) => {
    const aDated = a.dateUnknown ? 0 : 1;
    const bDated = b.dateUnknown ? 0 : 1;
    if (aDated !== bDated) return bDated - aDated;
    const ap = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bp = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    if (bp !== ap) return bp - ap;
    return Date.parse(b.foundAt) - Date.parse(a.foundAt);
  });
}

async function telegramHealth(): Promise<{
  ok: boolean;
  telegramConnected: boolean;
  accountId: string | null;
  username: string | null;
  error?: string;
}> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return {
        ok: false,
        telegramConnected: false,
        accountId: null,
        username: null,
        error: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      telegramConnected?: boolean;
      accountId?: string | null;
      username?: string | null;
    };
    return {
      ok: Boolean(data.ok),
      telegramConnected: Boolean(data.telegramConnected),
      accountId: data.accountId ?? null,
      username: data.username ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      telegramConnected: false,
      accountId: null,
      username: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getTaskRadarHealth() {
  const settings = await readTaskRadarSettings();
  const items = await readTaskRadarItems();
  const tg = await telegramHealth();
  const webDiagnosis = await diagnoseWebActor();
  const runsRaw = await fs.readFile(runsFile, "utf-8").catch(() => "");
  const lastRunLine = runsRaw.trim().split("\n").filter(Boolean).at(-1);
  let lastRun: unknown = null;
  if (lastRunLine) {
    try {
      lastRun = JSON.parse(lastRunLine);
    } catch {
      lastRun = null;
    }
  }

  return {
    ok: true,
    telegram: {
      connected: tg.telegramConnected,
      accountId: tg.accountId,
      username: tg.username,
      error: tg.error ?? null,
    },
    apify: {
      tokenConfigured: webDiagnosis.apifyTokenPresent,
      actorConfigured: webDiagnosis.apifyActorIdPresent,
      webActorConfigured: webDiagnosis.apifyWebActorIdPresent,
      suitableForWebSearch: webDiagnosis.suitableForWebSearch,
      reason: webDiagnosis.reason,
      actorName: webDiagnosis.actorName,
    },
    replyMode: settings.replyMode,
    autoEnvironment: settings.autoEnvironment,
    autoDisabledReason: settings.autoDisabledReason,
    resultsCount: items.length,
    newCount: items.filter((i) => i.status === "new").length,
    lastRun,
  };
}

export async function listTaskRadarItems(filters: {
  source?: string;
  status?: string;
  query?: string;
  limit?: number;
}): Promise<TaskRadarItem[]> {
  let items = await readTaskRadarItems();
  if (filters.source) {
    items = items.filter((i) => i.source === filters.source);
  }
  if (filters.status) {
    items = items.filter((i) => i.status === filters.status);
  }
  if (filters.query?.trim()) {
    const q = normalizeNeedle(filters.query);
    items = items.filter((i) => {
      const blob = `${i.text} ${i.sourceTitle || ""} ${i.matchedKeyword || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }
  const sorted = sortItems(items);
  const limit = Math.max(1, Math.min(filters.limit ?? 200, 500));
  return sorted.slice(0, limit);
}

export async function patchTaskRadarItem(
  id: string,
  patch: Partial<Pick<TaskRadarItem, "status">>
): Promise<TaskRadarItem | null> {
  const items = await readTaskRadarItems();
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const next = { ...items[idx], ...patch };
  if (patch.status === "replied" && !next.repliedAt) {
    next.repliedAt = new Date().toISOString();
  }
  items[idx] = next;
  await saveItems(items);
  return next;
}

function mergeIncoming(
  existing: TaskRadarItem[],
  incoming: Omit<TaskRadarItem, "id" | "status">[],
  excludes: string[]
): { items: TaskRadarItem[]; duplicates: number; excluded: number; kept: number } {
  const byFingerprint = new Map(existing.map((i) => [i.fingerprint, i]));
  let duplicates = 0;
  let excluded = 0;
  let kept = 0;

  for (const raw of incoming) {
    if (containsExclude(raw.text, excludes)) {
      excluded += 1;
      continue;
    }
    const prev = byFingerprint.get(raw.fingerprint);
    if (prev) {
      duplicates += 1;
      continue;
    }
    const item: TaskRadarItem = {
      ...raw,
      id: randomUUID(),
      status: "new",
    };
    byFingerprint.set(item.fingerprint, item);
    kept += 1;
  }

  return {
    items: sortItems([...byFingerprint.values()]),
    duplicates,
    excluded,
    kept,
  };
}

export async function runTaskRadarSearch(input?: {
  sources?: Array<"telegram" | "web">;
  maxAgeMinutes?: number;
}): Promise<{
  ok: boolean;
  items: TaskRadarItem[];
  stats: TaskRadarSearchStats;
  warnings: string[];
  webDiagnosis: WebActorDiagnosis;
  telegramError?: string;
  webError?: string;
}> {
  const settings = await readTaskRadarSettings();
  const maxAgeMinutes = input?.maxAgeMinutes ?? settings.maxAgeMinutes;
  const wantTelegram =
    (input?.sources ? input.sources.includes("telegram") : true) && settings.telegramEnabled;
  const wantWeb = (input?.sources ? input.sources.includes("web") : true) && settings.webEnabled;

  const warnings: string[] = [];
  const incoming: Omit<TaskRadarItem, "id" | "status">[] = [];
  let keywordsChecked = 0;
  let rawFound = 0;
  let telegramKept = 0;
  let webKept = 0;
  let telegramError: string | undefined;
  let webError: string | undefined;

  const webDiagnosis = await diagnoseWebActor();

  if (wantTelegram) {
    try {
      const res = await fetch(`${TELEGRAM_API_BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: settings.keywords,
          excludeKeywords: settings.excludeKeywords,
          maxAgeMinutes,
          limitPerKeyword: 30,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        items?: Array<Record<string, unknown>>;
        stats?: Record<string, number>;
        warnings?: string[];
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        telegramError = data.error || `telegram_http_${res.status}`;
        warnings.push(`Telegram search failed: ${telegramError}`);
      } else {
        keywordsChecked += data.stats?.keywordsChecked ?? settings.keywords.length;
        rawFound += data.stats?.rawFound ?? 0;
        for (const w of data.warnings || []) warnings.push(String(w));
        for (const row of data.items || []) {
          incoming.push({
            source: "telegram",
            externalId: (row.externalId as string | null) ?? null,
            fingerprint: String(row.fingerprint || `telegram:${row.externalId || randomUUID()}`),
            text: String(row.text || ""),
            publishedAt: (row.publishedAt as string | null) ?? null,
            foundAt: String(row.foundAt || new Date().toISOString()),
            dateUnknown: Boolean(row.dateUnknown),
            chatId: (row.chatId as string | null) ?? null,
            sourceTitle: (row.sourceTitle as string | null) ?? null,
            sourceUsername: (row.sourceUsername as string | null) ?? null,
            senderId: (row.senderId as string | null) ?? null,
            senderUsername: (row.senderUsername as string | null) ?? null,
            url: (row.url as string | null) ?? null,
            matchedKeyword: String(row.matchedKeyword || ""),
          });
          telegramKept += 1;
        }
      }
    } catch (error) {
      telegramError = error instanceof Error ? error.message : String(error);
      warnings.push(
        `Telegram API недоступен (${TELEGRAM_API_BASE}). Запустите Telegram Rewriter Bot. ${telegramError}`
      );
    }
  }

  if (wantWeb) {
    if (!webDiagnosis.suitableForWebSearch) {
      webError = webDiagnosis.reason;
      warnings.push(webDiagnosis.reason);
    } else {
      const web = await searchWebTasks({
        keywords: settings.keywords,
        domains: settings.webDomains,
        maxAgeMinutes,
      });
      for (const w of web.warnings) warnings.push(w);
      if (!web.ok) {
        webError = web.error || web.diagnosis.reason;
      } else {
        keywordsChecked = Math.max(keywordsChecked, settings.keywords.length);
        for (const row of web.items) {
          if (row.domain && settings.webDomains.length) {
            const okDomain = settings.webDomains.some(
              (d) => row.domain === d || row.domain?.endsWith(`.${d}`)
            );
            if (!okDomain) continue;
          }
          incoming.push({
            source: "web",
            externalId: row.externalId,
            fingerprint: row.fingerprint,
            text: row.text,
            title: row.title,
            publishedAt: row.publishedAt,
            foundAt: row.foundAt,
            dateUnknown: row.dateUnknown,
            sourceTitle: row.sourceTitle,
            sourceUsername: row.sourceUsername,
            url: row.url,
            matchedKeyword: row.matchedKeyword,
            domain: row.domain,
          });
          webKept += 1;
        }
      }
    }
  }

  const existing = await readTaskRadarItems();
  const merged = mergeIncoming(existing, incoming, settings.excludeKeywords);
  await saveItems(merged.items);

  const stats: TaskRadarSearchStats = {
    keywordsChecked,
    rawFound,
    kept: merged.kept,
    duplicates: merged.duplicates,
    excluded: merged.excluded,
    telegramKept,
    webKept,
  };

  await appendJsonl(runsFile, {
    at: new Date().toISOString(),
    sources: {
      telegram: wantTelegram,
      web: wantWeb,
    },
    maxAgeMinutes,
    stats,
    warnings,
    telegramError: telegramError ?? null,
    webError: webError ?? null,
  });

  return {
    ok: !telegramError || Boolean(wantWeb && !webError && webKept > 0) || merged.kept > 0,
    items: await listTaskRadarItems({ limit: 200 }),
    stats,
    warnings,
    webDiagnosis,
    telegramError,
    webError,
  };
}

export async function replyTaskRadarItem(
  id: string,
  mode: "mark" | "auto" = "mark"
): Promise<{ ok: boolean; item?: TaskRadarItem; draft?: string; error?: string }> {
  const settings = await readTaskRadarSettings();
  const items = await readTaskRadarItems();
  const item = items.find((i) => i.id === id);
  if (!item) return { ok: false, error: "item_not_found" };

  const draft = renderReplyTemplate(settings.replyTemplate, item);

  if (mode === "mark" || settings.replyMode !== "auto") {
    const updated = await patchTaskRadarItem(id, { status: "replied" });
    await appendJsonl(repliesFile, {
      ok: true,
      mode: "manual_mark",
      itemId: id,
      at: new Date().toISOString(),
    });
    return { ok: true, item: updated || item, draft };
  }

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/send-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: id, text: draft }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, draft, error: data.error || `send_failed_${res.status}` };
    }
    const updated = await patchTaskRadarItem(id, { status: "replied" });
    return { ok: true, item: updated || item, draft };
  } catch (error) {
    return {
      ok: false,
      draft,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildDraftDeepLink(item: TaskRadarItem, text: string): string | null {
  const username = item.senderUsername || item.sourceUsername;
  if (!username) return null;
  const clean = username.replace(/^@/, "");
  // Telegram share URL opens compose; full text paste is still manual on many clients.
  return `https://t.me/${clean}?text=${encodeURIComponent(text)}`;
}

export { DEFAULT_REPLY_TEMPLATE };
