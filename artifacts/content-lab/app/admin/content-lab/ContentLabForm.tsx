"use client";

import { useCallback, useEffect, useState } from "react";

type SourceRow = {
  id: number;
  mode: string;
  value: string;
  authorUsername: string | null;
  /** Стабильный key для React, не уходит в API. */
  rowKey: string;
};

type RefRow = {
  id: number;
  url: string;
  isPrimary: boolean;
  rowKey: string;
};

type LabState = {
  settings: {
    id: number;
    brandPrompt: string;
    hardRules: string;
    autoPublish: boolean;
    lookbackDays: number;
    minPostChars: number;
    maxPostsPerSource: number;
  };
  sources: SourceRow[];
  referenceImages: RefRow[];
};

function newRowKey(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ContentLabForm() {
  const [data, setData] = useState<LabState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pipeResult, setPipeResult] = useState<string | null>(null);
  const [cronSec, setCronSec] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    const r = await fetch("/api/admin/lab");
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    const j = (await r.json()) as Omit<LabState, "sources" | "referenceImages"> & {
      sources: Omit<SourceRow, "rowKey">[];
      referenceImages: Omit<RefRow, "rowKey">[];
    };
    setData({
      settings: j.settings,
      sources: j.sources.map((s) => ({
        ...s,
        rowKey: newRowKey(`s-${s.id}`),
      })),
      referenceImages: j.referenceImages.map((r) => ({
        ...r,
        rowKey: newRowKey(`r-${r.id}`),
      })),
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            brandPrompt: data.settings.brandPrompt,
            hardRules: data.settings.hardRules,
            autoPublish: data.settings.autoPublish,
            lookbackDays: data.settings.lookbackDays,
            minPostChars: data.settings.minPostChars,
            maxPostsPerSource: data.settings.maxPostsPerSource,
          },
          sources: data.sources
            .map((s) => ({
              mode: s.mode,
              value: s.value.trim(),
              authorUsername: s.authorUsername?.trim() || null,
            }))
            .filter((s) => s.value.length > 0),
          referenceImages: data.referenceImages
            .map((i) => ({
              url: i.url.trim(),
              isPrimary: i.isPrimary,
            }))
            .filter(
              (i) =>
                /^https?:\/\//i.test(i.url) && i.url.length > 8,
            ),
        }),
      });
      if (!r.ok) {
        setErr(await r.text());
        return;
      }
      const j = (await r.json()) as Omit<LabState, "sources" | "referenceImages"> & {
        sources: Omit<SourceRow, "rowKey">[];
        referenceImages: Omit<RefRow, "rowKey">[];
      };
      setData({
        settings: j.settings,
        sources: j.sources.map((s) => ({
          ...s,
          rowKey: newRowKey(`s-${s.id}`),
        })),
        referenceImages: j.referenceImages.map((r) => ({
          ...r,
          rowKey: newRowKey(`r-${r.id}`),
        })),
      });
    } finally {
      setSaving(false);
    }
  };

  const runPipeline = async () => {
    setPipeResult(null);
    const r = await fetch("/api/cron/content-pipeline", {
      headers: { "x-cron-secret": cronSec },
    });
    const j = await r.json();
    setPipeResult(JSON.stringify(j, null, 2));
  };

  if (!data) {
    return (
      <p className="text-slate-400">
        {err ?? "Загрузка… (нужен DATABASE_URL и `pnpm` миграция)"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {err && <pre className="whitespace-pre-wrap text-red-300">{err}</pre>}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-300">Настройки</h2>
        <label className="block text-xs text-slate-500">brandPrompt</label>
        <textarea
          className="h-32 w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm"
          value={data.settings.brandPrompt}
          onChange={(e) =>
            setData({
              ...data,
              settings: { ...data.settings, brandPrompt: e.target.value },
            })
          }
        />
        <label className="block text-xs text-slate-500">hardRules</label>
        <textarea
          className="h-20 w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm"
          value={data.settings.hardRules}
          onChange={(e) =>
            setData({
              ...data,
              settings: { ...data.settings, hardRules: e.target.value },
            })
          }
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={data.settings.autoPublish}
            onChange={(e) =>
              setData({
                ...data,
                settings: { ...data.settings, autoPublish: e.target.checked },
              })
            }
          />
          auto_publish (MVP: лучше сначала выкл. и смотреть драфты)
        </label>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="text-sm">
            lookback (дней){" "}
            <input
              type="number"
              className="ml-2 w-20 rounded border border-slate-700 bg-slate-900 p-1"
              value={data.settings.lookbackDays}
              onChange={(e) =>
                setData({
                  ...data,
                  settings: {
                    ...data.settings,
                    lookbackDays: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label className="text-sm">
            min длина текста{" "}
            <input
              type="number"
              className="ml-2 w-20 rounded border border-slate-700 bg-slate-900 p-1"
              value={data.settings.minPostChars}
              onChange={(e) =>
                setData({
                  ...data,
                  settings: {
                    ...data.settings,
                    minPostChars: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label className="text-sm">
            top-N / конкурент{" "}
            <input
              type="number"
              className="ml-2 w-20 rounded border border-slate-700 bg-slate-900 p-1"
              value={data.settings.maxPostsPerSource}
              onChange={(e) =>
                setData({
                  ...data,
                  settings: {
                    ...data.settings,
                    maxPostsPerSource: Number(e.target.value),
                  },
                })
              }
            />
          </label>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-slate-300">Источники</h2>
        <p className="text-xs text-slate-500">
          mode: <code>competitor</code> = handle без @,{" "}
          <code>keyword</code> = тема; для keyword можно указать
          authorUsername.
        </p>
        <ul className="mt-2 space-y-2">
          {data.sources.map((s, i) => (
            <li
              key={s.rowKey}
              className="flex flex-wrap items-center gap-2 rounded border border-slate-800 p-2"
            >
              <select
                className="rounded border border-slate-700 bg-slate-900 p-1 text-sm"
                value={s.mode}
                onChange={(e) => {
                  const n = [...data.sources];
                  n[i] = { ...n[i]!, mode: e.target.value };
                  setData({ ...data, sources: n });
                }}
              >
                <option value="competitor">competitor</option>
                <option value="keyword">keyword</option>
              </select>
              <input
                className="min-w-40 flex-1 rounded border border-slate-700 bg-slate-900 p-1 text-sm"
                value={s.value}
                placeholder="username или фраза"
                onChange={(e) => {
                  const n = [...data.sources];
                  n[i] = { ...n[i]!, value: e.target.value };
                  setData({ ...data, sources: n });
                }}
              />
              <input
                className="w-32 rounded border border-slate-700 bg-slate-900 p-1 text-sm"
                value={s.authorUsername ?? ""}
                placeholder="author (opt)"
                onChange={(e) => {
                  const n = [...data.sources];
                  n[i] = { ...n[i]!, authorUsername: e.target.value || null };
                  setData({ ...data, sources: n });
                }}
              />
              <button
                type="button"
                className="text-xs text-red-400"
                onClick={() => {
                  setData({
                    ...data,
                    sources: data.sources.filter((_, j) => j !== i),
                  });
                }}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-2 text-sm text-sky-400"
          onClick={() =>
            setData({
              ...data,
              sources: [
                ...data.sources,
                {
                  id: -1,
                  mode: "competitor",
                  value: "",
                  authorUsername: null,
                  rowKey: newRowKey("new-src"),
                },
              ],
            })
          }
        >
          + источник
        </button>
      </section>

      <section>
        <h2 className="text-sm font-medium text-slate-300">Рефы (HTTPS)</h2>
        {data.referenceImages.map((r, i) => (
          <div key={r.rowKey} className="mb-2 flex flex-wrap items-center gap-2">
            <input
              className="min-w-64 flex-1 rounded border border-slate-700 bg-slate-900 p-1 text-sm"
              value={r.url}
              onChange={(e) => {
                const n = [...data.referenceImages];
                n[i] = { ...n[i]!, url: e.target.value };
                setData({ ...data, referenceImages: n });
              }}
            />
            <label className="text-xs text-slate-500">
              <input
                type="checkbox"
                checked={r.isPrimary}
                onChange={(e) => {
                  const n = [...data.referenceImages];
                  n[i] = { ...n[i]!, isPrimary: e.target.checked };
                  setData({ ...data, referenceImages: n });
                }}
              />{" "}
              primary
            </label>
            <button
              type="button"
              className="text-xs text-red-400"
              onClick={() =>
                setData({
                  ...data,
                  referenceImages: data.referenceImages.filter(
                    (_, j) => j !== i,
                  ),
                })
              }
            >
              Удалить
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-sm text-sky-400"
          onClick={() =>
            setData({
              ...data,
              referenceImages: [
                ...data.referenceImages,
                {
                  id: -1,
                  url: "https://",
                  isPrimary: false,
                  rowKey: newRowKey("new-ref"),
                },
              ],
            })
          }
        >
          + URL
        </button>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>

      <section className="border-t border-slate-800 pt-6">
        <h2 className="text-sm font-medium text-slate-300">Тест cron</h2>
        <p className="text-xs text-slate-500">
          Заголовок <code className="text-slate-400">x-cron-secret</code> ={" "}
          <code className="text-slate-400">CRON_SECRET</code> из .env
        </p>
        <input
          className="mt-2 w-full max-w-md rounded border border-slate-700 bg-slate-900 p-2 text-sm"
          type="password"
          placeholder="CRON_SECRET"
          value={cronSec}
          onChange={(e) => setCronSec(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 block rounded border border-slate-600 px-3 py-1.5 text-sm"
          onClick={() => void runPipeline()}
        >
          Запустить пайплайн
        </button>
        {pipeResult && (
          <pre className="mt-2 max-h-64 overflow-auto rounded border border-slate-800 p-2 text-xs text-slate-300">
            {pipeResult}
          </pre>
        )}
      </section>
    </div>
  );
}
