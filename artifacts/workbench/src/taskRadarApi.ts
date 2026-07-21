import type {
  TaskRadarHealth,
  TaskRadarItem,
  TaskRadarItemStatus,
  TaskRadarSearchResult,
  TaskRadarSettings,
} from "./taskRadarTypes";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: string };
      detail = body.error || "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchTaskRadarHealth(): Promise<TaskRadarHealth> {
  const response = await fetch("/wb/task-radar/health");
  return readJson<TaskRadarHealth>(response);
}

export async function fetchTaskRadarSettings(): Promise<{
  settings: TaskRadarSettings;
  defaultReplyTemplate: string;
}> {
  const response = await fetch("/wb/task-radar/settings");
  return readJson(response);
}

export async function saveTaskRadarSettings(
  patch: Partial<TaskRadarSettings>
): Promise<TaskRadarSettings> {
  const response = await fetch("/wb/task-radar/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await readJson<{ settings: TaskRadarSettings }>(response);
  return data.settings;
}

export async function searchTaskRadar(body?: {
  sources?: Array<"telegram" | "web">;
  maxAgeMinutes?: number;
}): Promise<TaskRadarSearchResult> {
  const response = await fetch("/wb/task-radar/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return readJson<TaskRadarSearchResult>(response);
}

export async function fetchTaskRadarItems(filters?: {
  source?: string;
  status?: string;
  query?: string;
  limit?: number;
}): Promise<TaskRadarItem[]> {
  const params = new URLSearchParams();
  if (filters?.source) params.set("source", filters.source);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.query) params.set("query", filters.query);
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  const response = await fetch(`/wb/task-radar/items${qs ? `?${qs}` : ""}`);
  const data = await readJson<{ items: TaskRadarItem[] }>(response);
  return data.items;
}

export async function patchTaskRadarItem(
  id: string,
  status: TaskRadarItemStatus
): Promise<TaskRadarItem> {
  const response = await fetch(`/wb/task-radar/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await readJson<{ item: TaskRadarItem }>(response);
  return data.item;
}

export async function fetchTaskRadarDraft(id: string): Promise<{
  draft: string;
  deepLink: string | null;
  item: TaskRadarItem;
}> {
  const response = await fetch(`/wb/task-radar/items/${encodeURIComponent(id)}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return readJson(response);
}

export async function markTaskRadarReplied(id: string): Promise<{
  draft?: string;
  item?: TaskRadarItem;
}> {
  const response = await fetch(`/wb/task-radar/items/${encodeURIComponent(id)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auto: false }),
  });
  return readJson(response);
}
