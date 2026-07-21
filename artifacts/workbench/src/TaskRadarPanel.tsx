import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, ExternalLink, Loader2, Save, X } from "lucide-react";
import {
  fetchTaskRadarDraft,
  fetchTaskRadarHealth,
  fetchTaskRadarItems,
  fetchTaskRadarSettings,
  markTaskRadarReplied,
  patchTaskRadarItem,
  saveTaskRadarSettings,
  searchTaskRadar,
} from "./taskRadarApi";
import type {
  AutoEnvironment,
  ReplyMode,
  TaskRadarHealth,
  TaskRadarItem,
  TaskRadarSettings,
} from "./taskRadarTypes";

type TaskRadarPanelProps = {
  onClose: () => void;
  onSummaryChanged?: (summary: {
    newCount: number;
    lastRunAt: string | null;
    telegramOk: boolean;
    webOk: boolean;
  }) => void;
};

const PERIODS: Array<{ label: string; minutes: number }> = [
  { label: "15 минут", minutes: 15 },
  { label: "30 минут", minutes: 30 },
  { label: "1 час", minutes: 60 },
  { label: "3 часа", minutes: 180 },
  { label: "12 часов", minutes: 720 },
  { label: "24 часа", minutes: 1440 },
];

function formatAgo(iso: string | null): string {
  if (!iso) return "дата неизвестна";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "дата неизвестна";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
}

function linesToList(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSourcesText(value: string): Array<{ id: string; username: string; active: boolean }> {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const inactive = line.startsWith("#");
      const username = line.replace(/^#/, "").trim().replace(/^@/, "");
      return {
        id: username.toLowerCase(),
        username,
        active: !inactive && Boolean(username),
      };
    })
    .filter((s) => s.username);
}

function modeLabel(mode?: string): string {
  if (mode === "public_posts") return "публичные посты";
  if (mode === "public_groups") return "публичные группы";
  if (mode === "my_sources") return "мои источники";
  return "telegram";
}

export function TaskRadarPanel({ onClose, onSummaryChanged }: TaskRadarPanelProps) {
  const [settings, setSettings] = useState<TaskRadarSettings | null>(null);
  const [defaultTemplate, setDefaultTemplate] = useState("");
  const [health, setHealth] = useState<TaskRadarHealth | null>(null);
  const [items, setItems] = useState<TaskRadarItem[]>([]);
  const [keywordsText, setKeywordsText] = useState("");
  const [excludeText, setExcludeText] = useState("");
  const [domainsText, setDomainsText] = useState("");
  const [sourcesText, setSourcesText] = useState("");
  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [liveConfirm, setLiveConfirm] = useState(false);

  const visibleItems = useMemo(
    () => items.filter((i) => i.status !== "ignored"),
    [items]
  );

  async function refreshAll() {
    const [settingsRes, healthRes, itemsRes] = await Promise.all([
      fetchTaskRadarSettings(),
      fetchTaskRadarHealth(),
      fetchTaskRadarItems({ limit: 200 }),
    ]);
    setSettings(settingsRes.settings);
    setDefaultTemplate(settingsRes.defaultReplyTemplate);
    setKeywordsText(settingsRes.settings.keywords.join("\n"));
    setExcludeText(settingsRes.settings.excludeKeywords.join("\n"));
    setDomainsText(settingsRes.settings.webDomains.join("\n"));
    setSourcesText(
      (settingsRes.settings.telegramSources || [])
        .map((s) => `${s.active === false ? "#" : ""}${s.username}`)
        .join("\n")
    );
    setTemplate(settingsRes.settings.replyTemplate);
    setHealth(healthRes);
    setItems(itemsRes);
    onSummaryChanged?.({
      newCount: healthRes.newCount,
      lastRunAt: healthRes.lastRun?.at ?? null,
      telegramOk: healthRes.telegram.connected,
      webOk: healthRes.apify.suitableForWebSearch,
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setLoading(true);
      setError(null);
      try {
        await refreshAll();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persistSettings(patch: Partial<TaskRadarSettings>) {
    setSaving(true);
    setError(null);
    try {
      const next = await saveTaskRadarSettings(patch);
      setSettings(next);
      setKeywordsText(next.keywords.join("\n"));
      setExcludeText(next.excludeKeywords.join("\n"));
      setDomainsText(next.webDomains.join("\n"));
      setSourcesText(
        (next.telegramSources || [])
          .map((s) => `${s.active === false ? "#" : ""}${s.username}`)
          .join("\n")
      );
      setTemplate(next.replyTemplate);
      const healthRes = await fetchTaskRadarHealth();
      setHealth(healthRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleSearch() {
    if (!settings) return;
    setSearching(true);
    setError(null);
    setWarnings([]);
    try {
      await persistSettings({
        keywords: linesToList(keywordsText),
        excludeKeywords: linesToList(excludeText),
        webDomains: linesToList(domainsText),
        telegramSources: parseSourcesText(sourcesText),
        replyTemplate: template,
        maxAgeMinutes: settings.maxAgeMinutes,
        telegramEnabled: settings.telegramEnabled,
        telegramPublicPostsEnabled: settings.telegramPublicPostsEnabled,
        telegramPublicGroupsEnabled: settings.telegramPublicGroupsEnabled,
        telegramMySourcesEnabled: settings.telegramMySourcesEnabled,
        webEnabled: settings.webEnabled,
      });
      const sources: Array<"telegram" | "web"> = [];
      if (settings.telegramEnabled) sources.push("telegram");
      if (settings.webEnabled) sources.push("web");
      const result = await searchTaskRadar({
        sources,
        maxAgeMinutes: settings.maxAgeMinutes,
      });
      setItems(result.items);
      setWarnings(result.warnings || []);
      if (result.telegramError || result.webError) {
        setError([result.telegramError, result.webError].filter(Boolean).join(" · ") || null);
      }
      const healthRes = await fetchTaskRadarHealth();
      setHealth(healthRes);
      onSummaryChanged?.({
        newCount: healthRes.newCount,
        lastRunAt: healthRes.lastRun?.at ?? null,
        telegramOk: healthRes.telegram.connected,
        webOk: healthRes.apify.suitableForWebSearch,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  async function handleCopy(item: TaskRadarItem) {
    try {
      const { draft } = await fetchTaskRadarDraft(item.id);
      await navigator.clipboard.writeText(draft);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1500);
      const refreshed = await fetchTaskRadarItems({ limit: 200 });
      setItems(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleWrite(item: TaskRadarItem) {
    try {
      const { draft, deepLink } = await fetchTaskRadarDraft(item.id);
      await navigator.clipboard.writeText(draft);
      if (deepLink) window.open(deepLink, "_blank", "noopener,noreferrer");
      else if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
      const refreshed = await fetchTaskRadarItems({ limit: 200 });
      setItems(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOpen(item: TaskRadarItem) {
    if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
    try {
      await patchTaskRadarItem(item.id, "opened");
      setItems(await fetchTaskRadarItems({ limit: 200 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleReplied(item: TaskRadarItem) {
    try {
      await markTaskRadarReplied(item.id);
      setItems(await fetchTaskRadarItems({ limit: 200 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleHide(item: TaskRadarItem) {
    try {
      await patchTaskRadarItem(item.id, "ignored");
      setItems(await fetchTaskRadarItems({ limit: 200 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function setReplyMode(mode: ReplyMode) {
    if (!settings) return;
    if (mode === "auto" && settings.autoEnvironment === "live" && !settings.autoLiveConfirmed) {
      setLiveConfirm(true);
      return;
    }
    await persistSettings({ replyMode: mode });
  }

  async function setAutoEnv(env: AutoEnvironment) {
    if (!settings) return;
    if (env === "live" && !settings.autoLiveConfirmed) {
      setLiveConfirm(true);
      await persistSettings({ autoEnvironment: "live", replyMode: settings.replyMode === "auto" ? "draft" : settings.replyMode });
      return;
    }
    await persistSettings({ autoEnvironment: env });
  }

  if (loading || !settings) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#12121a] px-5 py-4 text-white">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка радара…
        </div>
      </div>
    );
  }

  const showWrite = settings.replyMode === "draft" || settings.replyMode === "auto";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm md:p-6">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f16] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/8 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Радар задач</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => void persistSettings({ telegramEnabled: !settings.telegramEnabled })}
                className={`rounded-full border px-2.5 py-1 ${
                  settings.telegramEnabled
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : "border-white/10 text-white/40"
                }`}
              >
                Telegram {settings.telegramEnabled ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                disabled={!settings.telegramEnabled}
                onClick={() =>
                  void persistSettings({
                    telegramPublicPostsEnabled: !settings.telegramPublicPostsEnabled,
                  })
                }
                className={`rounded-full border px-2.5 py-1 ${
                  settings.telegramEnabled && settings.telegramPublicPostsEnabled
                    ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                    : "border-white/10 text-white/40"
                }`}
              >
                Все публичные посты
              </button>
              <button
                type="button"
                disabled={!settings.telegramEnabled}
                onClick={() =>
                  void persistSettings({
                    telegramPublicGroupsEnabled: !settings.telegramPublicGroupsEnabled,
                  })
                }
                className={`rounded-full border px-2.5 py-1 ${
                  settings.telegramEnabled && settings.telegramPublicGroupsEnabled
                    ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                    : "border-white/10 text-white/40"
                }`}
              >
                Публичные группы
              </button>
              <button
                type="button"
                disabled={!settings.telegramEnabled}
                onClick={() =>
                  void persistSettings({
                    telegramMySourcesEnabled: !settings.telegramMySourcesEnabled,
                  })
                }
                className={`rounded-full border px-2.5 py-1 ${
                  settings.telegramEnabled && settings.telegramMySourcesEnabled
                    ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                    : "border-white/10 text-white/40"
                }`}
              >
                Мои источники
              </button>
              <button
                type="button"
                onClick={() => void persistSettings({ webEnabled: !settings.webEnabled })}
                className={`rounded-full border px-2.5 py-1 ${
                  settings.webEnabled
                    ? "border-sky-400/30 bg-sky-400/10 text-sky-200"
                    : "border-white/10 text-white/40"
                }`}
              >
                Интернет {settings.webEnabled ? "ON" : "OFF"}
              </button>
              <span
                className="rounded-full border border-white/10 px-2.5 py-1 text-white/35"
                title="Подключим после восстановления VK API"
              >
                VK позже
              </span>
              <span
                className="rounded-full border border-white/10 px-2.5 py-1 text-white/30"
                title="Личные диалоги никогда не попадают в выдачу"
              >
                Личные диалоги OFF
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 p-2 text-white/60 hover:text-white"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-4 text-sm">
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Период</p>
              <div className="flex flex-wrap gap-1.5">
                {PERIODS.map((p) => (
                  <button
                    key={p.minutes}
                    type="button"
                    onClick={() => void persistSettings({ maxAgeMinutes: p.minutes })}
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      settings.maxAgeMinutes === p.minutes
                        ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                        : "border-white/10 text-white/50"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-white/40">
                Мои источники (username, # = выкл)
              </span>
              <textarea
                value={sourcesText}
                onChange={(e) => setSourcesText(e.target.value)}
                rows={4}
                placeholder={"freelancers_chat\n#old_channel"}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-amber-400/40"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-white/40">Ключи включения</span>
              <textarea
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                rows={6}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-amber-400/40"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-white/40">Ключи исключения</span>
              <textarea
                value={excludeText}
                onChange={(e) => setExcludeText(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-amber-400/40"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-white/40">Шаблон ответа</span>
              <textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={5}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-amber-400/40"
              />
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setTemplate(defaultTemplate)}
                  className="text-xs text-white/40 hover:text-white/70"
                >
                  По умолчанию
                </button>
                <span className="text-xs text-white/25">{"{{keyword}} {{source}} {{url}}"}</span>
              </div>
            </label>

            <div>
              <p className="mb-1 text-xs text-white/40">Режим ответа</p>
              <div className="flex flex-wrap gap-1.5">
                {(["off", "draft", "auto"] as ReplyMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => void setReplyMode(mode)}
                    className={`rounded-lg border px-2 py-1 text-xs uppercase ${
                      settings.replyMode === mode
                        ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                        : "border-white/10 text-white/50"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(["test", "live"] as AutoEnvironment[]).map((env) => (
                  <button
                    key={env}
                    type="button"
                    onClick={() => void setAutoEnv(env)}
                    className={`rounded-lg border px-2 py-1 text-xs uppercase ${
                      settings.autoEnvironment === env
                        ? "border-rose-400/40 bg-rose-400/10 text-rose-100"
                        : "border-white/10 text-white/50"
                    }`}
                  >
                    {env}
                  </button>
                ))}
              </div>
              {settings.autoDisabledReason ? (
                <p className="mt-2 text-xs text-amber-300">{settings.autoDisabledReason}</p>
              ) : null}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-white/40">Домены для web</span>
              <textarea
                value={domainsText}
                onChange={(e) => setDomainsText(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-amber-400/40"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void persistSettings({
                    keywords: linesToList(keywordsText),
                    excludeKeywords: linesToList(excludeText),
                    webDomains: linesToList(domainsText),
                    telegramSources: parseSourcesText(sourcesText),
                    replyTemplate: template,
                  })
                }
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] py-2 text-xs text-white/70"
              >
                <Save className="h-3.5 w-3.5" />
                Сохранить
              </button>
            </div>

            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-xs text-white/45">
              <p>TG: {health?.telegram.connected ? "connected" : "offline"}</p>
              <p className="mt-1">
                Web:{" "}
                {health?.apify.suitableForWebSearch
                  ? "ready"
                  : health?.apify.reason || "не настроен"}
              </p>
            </div>
          </aside>

          <section className="space-y-3">
            <button
              type="button"
              disabled={searching}
              onClick={() => void handleSearch()}
              className="w-full rounded-xl border border-amber-400/30 bg-gradient-to-b from-amber-900/60 to-slate-950 py-3 text-sm font-semibold tracking-wide text-white hover:border-amber-300/50 disabled:opacity-60"
            >
              {searching ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ищем…
                </span>
              ) : (
                "НАЙТИ СВЕЖИЕ ЗАДАЧИ"
              )}
            </button>

            {error ? <p className="text-sm text-amber-300">{error}</p> : null}
            {warnings.map((w) => (
              <p key={w} className="text-xs text-white/40">
                {w}
              </p>
            ))}

            {visibleItems.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/35">
                Пока нет результатов. Задайте ключи и нажмите поиск.
              </p>
            ) : (
              visibleItems.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-white/8 bg-white/[0.02] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-white/45">
                    <span className="rounded-md border border-white/10 px-1.5 py-0.5 uppercase text-white/70">
                      {item.source === "telegram" ? modeLabel(item.telegramMode) : item.source}
                    </span>
                    <span>
                      {item.dateUnknown
                        ? "дата неизвестна"
                        : formatAgo(item.publishedAt)}
                    </span>
                    <span className="text-white/25">·</span>
                    <span>{item.sourceTitle || item.sourceUsername || "источник"}</span>
                    {item.status !== "new" ? (
                      <span className="rounded-md border border-white/10 px-1.5 py-0.5">
                        {item.status}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-amber-200/80">
                    Найдено по: «{item.matchedKeyword}»
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                    {item.text}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleOpen(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:text-white"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Открыть
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopy(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:text-white"
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                      {copiedId === item.id ? "Скопировано" : "Скопировать ответ"}
                    </button>
                    {showWrite ? (
                      <button
                        type="button"
                        onClick={() => void handleWrite(item)}
                        className="rounded-lg border border-amber-400/25 px-2.5 py-1.5 text-xs text-amber-100"
                      >
                        Написать
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleReplied(item)}
                      className="rounded-lg border border-emerald-400/20 px-2.5 py-1.5 text-xs text-emerald-200/80"
                    >
                      Ответил
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleHide(item)}
                      className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/40"
                    >
                      Скрыть
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        </div>
      </div>

      {liveConfirm ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-4">
          <div className="max-w-md rounded-2xl border border-rose-400/30 bg-[#16161f] p-5 text-sm text-white">
            <p className="font-medium">Включить AUTO LIVE?</p>
            <p className="mt-2 text-white/60">
              Сообщения уйдут реальным отправителям найденных постов. Для тестов
              используйте TEST и TASK_RADAR_TEST_USERNAME.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-xl border border-rose-400/40 bg-rose-500/20 px-3 py-2 text-xs"
                onClick={() => {
                  setLiveConfirm(false);
                  void persistSettings({
                    autoEnvironment: "live",
                    autoLiveConfirmed: true,
                    replyMode: "auto",
                  });
                }}
              >
                Подтверждаю LIVE
              </button>
              <button
                type="button"
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60"
                onClick={() => setLiveConfirm(false)}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
