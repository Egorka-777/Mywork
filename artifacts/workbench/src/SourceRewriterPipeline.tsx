import { useRef, useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import type {
  ExtractedSource,
  ExtractedVisualDescription,
  PlagiarismSafety,
  OutputLength,
  RewriteMode,
  RewriteSettings,
  RewrittenSource,
  StyleIntensity,
} from "./sourceRewriterTypes";

export type {
  SourceFileType,
  ExtractedVisualDescription,
  ExtractedPage,
  ExtractedSlide,
  ExtractedSource,
  RewriteMode,
  OutputLength,
  StyleIntensity,
  PlagiarismSafety,
  RewriteSettings,
  RewrittenSource,
} from "./sourceRewriterTypes";

const REWRITE_MODE_OPTIONS: { value: RewriteMode; label: string }[] = [
  {
    value: "preserve_original_structure",
    label: "Сохранить исходную структуру",
  },
  { value: "storytelling_text", label: "Преобразовать в сторителлинг" },
  { value: "presentation_text", label: "Преобразовать в текст презентации" },
  { value: "carousel_script", label: "Преобразовать в сценарий карусели" },
  { value: "lesson_material", label: "Преобразовать в урок / учебный материал" },
  { value: "clean_article", label: "Преобразовать в статью" },
  { value: "sales_page_text", label: "Преобразовать в продающий текст" },
  { value: "telegram_post", label: "Преобразовать в Telegram-пост" },
  { value: "instagram_post", label: "Преобразовать в Instagram-пост" },
];

const OUTPUT_LENGTH_OPTIONS: { value: OutputLength; label: string }[] = [
  { value: "keep_similar_length", label: "Сохранить похожий объём" },
  { value: "shorter", label: "Короче" },
  { value: "longer", label: "Длиннее" },
  { value: "very_concise", label: "Очень кратко" },
  { value: "expanded", label: "Развёрнуто" },
];

const STYLE_INTENSITY_OPTIONS: { value: StyleIntensity; label: string }[] = [
  { value: "light_rewrite", label: "Лёгкая переработка" },
  { value: "normal_rewrite", label: "Стандартная переработка" },
  { value: "strong_rewrite", label: "Глубокая переработка" },
];

const PLAGIARISM_OPTIONS: { value: PlagiarismSafety; label: string }[] = [
  { value: "light_uniqueness", label: "Лёгкая уникализация" },
  { value: "strong_uniqueness", label: "Сильная уникализация" },
  {
    value: "maximum_uniqueness_without_losing_meaning",
    label: "Максимальная уникализация без потери смысла",
  },
];

const FILE_ACCEPT =
  ".mp4,.mov,.mp3,.wav,.pdf,.pptx,.txt,.md,.docx,.png,.jpg,.jpeg,.webp";

const defaultSettings: RewriteSettings = {
  rewriteMode: "preserve_original_structure",
  outputLength: "keep_similar_length",
  styleIntensity: "normal_rewrite",
  plagiarismSafety: "strong_uniqueness",
};

function fieldClass(readonly = false) {
  return `mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#14b8a6]/50 focus:outline-none ${readonly ? "opacity-80" : ""}`;
}

function sectionTitle(text: string) {
  return (
    <h3 className="font-sans text-sm font-semibold tracking-wide text-white/90 uppercase">
      {text}
    </h3>
  );
}

function buildStructuredMarkdown(r: RewrittenSource): string {
  const lines: string[] = ["# Переписанный материал", ""];
  if (r.rewrittenPages?.length) {
    for (const p of r.rewrittenPages) {
      lines.push(`## Страница ${p.pageNumber}`, "", p.rewrittenText, "");
    }
    return lines.join("\n");
  }
  if (r.rewrittenSlides?.length) {
    for (const s of r.rewrittenSlides) {
      lines.push(`## Слайд ${s.slideNumber}`, "", s.rewrittenText, "");
    }
    return lines.join("\n");
  }
  if (r.rewrittenTranscript?.trim()) {
    lines.push("## Транскрипт", "", r.rewrittenTranscript, "");
    return lines.join("\n");
  }
  return lines.join("\n");
}

function copyText(text: string) {
  void navigator.clipboard.writeText(text);
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function VisualAssetFields({
  asset,
  onChange,
  prefix,
}: {
  asset: ExtractedVisualDescription;
  onChange: (next: ExtractedVisualDescription) => void;
  prefix: string;
}) {
  const set = (patch: Partial<ExtractedVisualDescription>) =>
    onChange({ ...asset, ...patch });
  return (
    <div className="space-y-2 rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <p className="text-xs font-medium text-[#14b8a6]">{prefix}</p>
      <label className="block text-xs text-white/45">
        тип
        <select
          className={fieldClass()}
          value={asset.type}
          onChange={(e) =>
            set({
              type: e.target.value as ExtractedVisualDescription["type"],
            })
          }
        >
          {(
            [
              "photo",
              "screenshot",
              "chart",
              "graphic",
              "ui",
              "unknown",
            ] as const
          ).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ["visibleText", "видимый текст"],
          ["visualDescription", "визуальное описание"],
          ["styleDescription", "описание стиля"],
          ["clothing", "одежда"],
          ["accessoriesAndProps", "аксессуары и реквизит"],
          ["lighting", "освещение"],
          ["background", "фон"],
          ["composition", "композиция"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="block text-xs text-white/45">
          {label}
          <textarea
            className={`${fieldClass()} min-h-[52px]`}
            value={asset[key]}
            onChange={(e) => set({ [key]: e.target.value } as Partial<ExtractedVisualDescription>)}
          />
        </label>
      ))}
      <label className="block text-xs text-white/45">
        цвета (по одному в строке)
        <textarea
          className={`${fieldClass()} min-h-[52px]`}
          value={asset.colors.join("\n")}
          onChange={(e) =>
            set({
              colors: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label className="block text-xs text-white/45">
        заметки для воссоздания (по одному)
        <textarea
          className={`${fieldClass()} min-h-[52px]`}
          value={asset.recreationNotes.join("\n")}
          onChange={(e) =>
            set({
              recreationNotes: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
    </div>
  );
}

// ─── Log console types ───────────────────────────────────────────────────────

type LogKind = "info" | "ok" | "err" | "warn" | "step";

interface LogLine {
  t: string;      // timestamp HH:MM:SS
  msg: string;
  kind: LogKind;
}

function nowHMS() {
  return new Date().toTimeString().slice(0, 8);
}

// ─── Video / audio file detector ─────────────────────────────────────────────

function isVideoFile(f: File) {
  return /\.(mp4|mov)$/i.test(f.name);
}
function isAudioFile(f: File) {
  return /\.(mp3|wav)$/i.test(f.name);
}

// ─── Log console component ───────────────────────────────────────────────────

function LogConsole({ lines }: { lines: LogLine[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  if (lines.length === 0) return null;

  const kindCls: Record<LogKind, string> = {
    info: "text-white/55",
    step: "text-sky-300/90",
    ok:   "text-emerald-400",
    warn: "text-amber-300/90",
    err:  "text-red-400",
  };
  const kindPfx: Record<LogKind, string> = {
    info: "·",
    step: "▶",
    ok:   "✓",
    warn: "⚠",
    err:  "✕",
  };

  return (
    <div className="mt-4 rounded-lg border border-white/8 bg-black/40 p-3 font-mono text-[11px] leading-5">
      <p className="mb-1.5 text-[10px] uppercase tracking-widest text-white/25">
        лог запроса
      </p>
      <div className="max-h-52 overflow-y-auto space-y-0.5">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-white/25">{l.t}</span>
            <span className={`shrink-0 ${kindCls[l.kind]}`}>{kindPfx[l.kind]}</span>
            <span className={kindCls[l.kind]}>{l.msg}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export function SourceRewriterPipeline() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [status, setStatus] = useState<
    "idle" | "extracting" | "rewriting" | "error"
  >("idle");
  const [extracted, setExtracted] = useState<ExtractedSource | null>(null);
  const [editedSource, setEditedSource] = useState<ExtractedSource | null>(null);
  const [settings, setSettings] = useState<RewriteSettings>(defaultSettings);
  const [rewritten, setRewritten] = useState<RewrittenSource | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<LogLine[]>([]);

  const showExtracted = extracted !== null && editedSource !== null;
  const showRewritten = rewritten !== null;

  const pushLog = (msg: string, kind: LogKind = "info") => {
    setLogLines((prev) => [...prev, { t: nowHMS(), msg, kind }]);
  };

  const runExtract = async () => {
    if (!file) return;
    setStatus("idle");
    setErrorText(null);
    setExtracted(null);
    setEditedSource(null);
    setRewritten(null);
    setLogLines([]);
    setStatus("extracting");

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);

    pushLog(`Файл: ${file.name} (${sizeMB} MB, .${ext})`, "info");
    pushLog("Отправляю запрос на сервер...", "step");

    if (isVideoFile(file)) {
      pushLog("Ожидаю: конвертация видео → MP3 (ffmpeg)...", "info");
      pushLog("Ожидаю: транскрипция MP3 → текст (Groq Whisper)...", "info");
    } else if (isAudioFile(file)) {
      pushLog("Ожидаю: транскрипция аудио → текст (Groq Whisper)...", "info");
    }

    const t0 = Date.now();

    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/wb/source-rewriter/extract", {
        method: "POST",
        body: fd,
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      pushLog(`Ответ от сервера: HTTP ${r.status} (${elapsed}s)`, r.ok ? "info" : "err");

      const data = (await r.json()) as ExtractedSource & {
        error?: string;
        detail?: string;
        raw?: string;
        step?: string;
        reqId?: string;
      };

      if (!r.ok) {
        // Детальный разбор ошибки
        if (data.reqId) pushLog(`reqId: ${data.reqId}`, "warn");
        if (data.step)  pushLog(`Шаг сбоя: ${data.step}`, "warn");
        if (data.error) pushLog(`Ошибка: ${data.error}`, "err");
        if (data.detail) pushLog(`Детали: ${data.detail}`, "err");
        if (data.raw)   pushLog(`Raw: ${data.raw.slice(0, 300)}`, "warn");
        const msg = [data.error, data.detail].filter(Boolean).join(" — ");
        throw new Error(msg || `HTTP ${r.status}`);
      }

      const chars = data.fullRawText?.length ?? 0;
      pushLog(`Извлечено: ${chars} символов`, "ok");
      if (data.transcript) pushLog(`Транскрипт: ${data.transcript.length} символов`, "ok");
      pushLog("Готово ✓", "ok");

      setExtracted(data);
      setEditedSource(structuredClone(data));
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      const msg = e instanceof Error ? e.message : String(e);
      if (!logLines.some((l) => l.kind === "err")) {
        pushLog(msg, "err");
      }
      setErrorText(msg);
    }
  };

  const runRewrite = async () => {
    if (!extracted || !editedSource) return;
    setErrorText(null);
    setStatus("rewriting");
    pushLog("Отправляю на рерайт...", "step");
    const t0 = Date.now();
    try {
      const r = await fetch("/wb/source-rewriter/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extractedSource: extracted, editedSource, settings }),
      });
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      pushLog(`Рерайт: HTTP ${r.status} (${elapsed}s)`, r.ok ? "ok" : "err");

      const data = (await r.json()) as RewrittenSource & {
        error?: string;
        raw?: string;
      };
      if (!r.ok) {
        const msg = [data.error, data.raw].filter(Boolean).join(" — ");
        pushLog(msg || `HTTP ${r.status}`, "err");
        throw new Error(msg || `HTTP ${r.status}`);
      }
      pushLog("Рерайт завершён ✓", "ok");
      setRewritten(data);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      const msg = e instanceof Error ? e.message : String(e);
      setErrorText(msg);
    }
  };

  const resetAll = () => {
    setFile(null);
    setFileKey((k) => k + 1);
    setExtracted(null);
    setEditedSource(null);
    setRewritten(null);
    setSettings(defaultSettings);
    setErrorText(null);
    setStatus("idle");
    setLogLines([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const copyAll = () => {
    if (!rewritten) return;
    const text =
      rewritten.fullRewrittenText.trim() ||
      buildStructuredMarkdown(rewritten).trim();
    copyText(text);
  };

  const setEdited = (updater: (e: ExtractedSource) => ExtractedSource) => {
    setEditedSource((prev) => (prev ? updater(prev) : prev));
  };

  return (
    <div className="flex flex-col gap-8">
      {errorText && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/95"
        >
          {errorText}
        </div>
      )}

      {/* 1. Upload Source */}
      <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
        {sectionTitle("1. Загрузить файл")}
        <input
          key={fileKey}
          ref={fileRef}
          type="file"
          accept={FILE_ACCEPT}
          className="mt-3 block w-full text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-white"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setExtracted(null);
            setEditedSource(null);
            setRewritten(null);
            setErrorText(null);
          }}
        />
        <button
          type="button"
          disabled={!file || status === "extracting"}
          onClick={() => void runExtract()}
          className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-[#14b8a6]/30 bg-[#14b8a6]/15 px-4 py-2.5 text-sm font-medium text-white transition enabled:hover:border-[#14b8a6]/50 enabled:hover:bg-[#14b8a6]/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === "extracting" && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          )}
          {status === "extracting" ? "Извлекаю…" : "Извлечь"}
        </button>

        <LogConsole lines={logLines} />
      </section>

      {/* 2. Extracted Source */}
      {showExtracted && editedSource && (
        <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          {sectionTitle("2. Извлечённый материал")}
          <div className="mt-3 grid gap-2 text-sm text-white/60">
            <p>
              <span className="text-white/40">Файл:</span>{" "}
              {editedSource.fileName}
            </p>
            <p>
              <span className="text-white/40">Тип:</span>{" "}
              {editedSource.fileType}
            </p>
          </div>
          {editedSource.extractionWarnings.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-sm text-amber-200/90">
              {editedSource.extractionWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <label className="mt-4 block text-xs text-white/45">
            Полный текст
            <textarea
              className={`${fieldClass()} min-h-[140px] font-mono text-xs`}
              value={editedSource.fullRawText}
              onChange={(e) =>
                setEdited((prev) => ({
                  ...prev,
                  fullRawText: e.target.value,
                }))
              }
            />
          </label>
          {editedSource.transcript !== undefined && (
            <label className="mt-3 block text-xs text-white/45">
              Транскрипт
              <textarea
                className={`${fieldClass()} min-h-[100px] font-mono text-xs`}
                value={editedSource.transcript ?? ""}
                onChange={(e) =>
                  setEdited((prev) => ({
                    ...prev,
                    transcript: e.target.value,
                  }))
                }
              />
            </label>
          )}
          {editedSource.pages?.map((page, pi) => (
            <div key={page.pageNumber} className="mt-6 border-t border-white/6 pt-4">
              <p className="text-sm font-semibold text-white">
                СТРАНИЦА {page.pageNumber}
              </p>
              <label className="mt-2 block text-xs text-white/45">
                исходный текст
                <textarea
                  className={`${fieldClass()} min-h-[100px]`}
                  value={page.rawText}
                  onChange={(e) =>
                    setEdited((prev) => {
                      const pages = [...(prev.pages ?? [])];
                      pages[pi] = { ...pages[pi], rawText: e.target.value };
                      return { ...prev, pages };
                    })
                  }
                />
              </label>
              {page.visualAssets.map((a, ai) => (
                <div key={a.id} className="mt-3">
                  <VisualAssetFields
                    prefix={`ВИЗУАЛ — страница ${page.pageNumber} #${ai + 1}`}
                    asset={a}
                    onChange={(next) =>
                      setEdited((prev) => {
                        const pages = [...(prev.pages ?? [])];
                        const vas = [...pages[pi].visualAssets];
                        vas[ai] = next;
                        pages[pi] = { ...pages[pi], visualAssets: vas };
                        return { ...prev, pages };
                      })
                    }
                  />
                </div>
              ))}
            </div>
          ))}
          {editedSource.slides?.map((slide, si) => (
            <div
              key={slide.slideNumber}
              className="mt-6 border-t border-white/6 pt-4"
            >
              <p className="text-sm font-semibold text-white">
                СЛАЙД {slide.slideNumber}
              </p>
              <label className="mt-2 block text-xs text-white/45">
                исходный текст
                <textarea
                  className={`${fieldClass()} min-h-[100px]`}
                  value={slide.rawText}
                  onChange={(e) =>
                    setEdited((prev) => {
                      const slides = [...(prev.slides ?? [])];
                      slides[si] = { ...slides[si], rawText: e.target.value };
                      return { ...prev, slides };
                    })
                  }
                />
              </label>
              <label className="mt-2 block text-xs text-white/45">
                заметки по макету
                <textarea
                  className={`${fieldClass()} min-h-[72px]`}
                  value={slide.layoutNotes}
                  onChange={(e) =>
                    setEdited((prev) => {
                      const slides = [...(prev.slides ?? [])];
                      slides[si] = {
                        ...slides[si],
                        layoutNotes: e.target.value,
                      };
                      return { ...prev, slides };
                    })
                  }
                />
              </label>
              {slide.visualAssets.map((a, ai) => (
                <div key={a.id} className="mt-3">
                  <VisualAssetFields
                    prefix={`ВИЗУАЛ — слайд ${slide.slideNumber} #${ai + 1}`}
                    asset={a}
                    onChange={(next) =>
                      setEdited((prev) => {
                        const slides = [...(prev.slides ?? [])];
                        const vas = [...slides[si].visualAssets];
                        vas[ai] = next;
                        slides[si] = { ...slides[si], visualAssets: vas };
                        return { ...prev, slides };
                      })
                    }
                  />
                </div>
              ))}
            </div>
          ))}
          {editedSource.visualAssets.length > 0 && (
            <div className="mt-4 space-y-3 border-t border-white/6 pt-4">
              {editedSource.visualAssets.map((a, vi) => (
                <VisualAssetFields
                  key={a.id}
                  prefix={`ВИЗУАЛ ${vi + 1}`}
                  asset={a}
                  onChange={(next) =>
                    setEdited((prev) => {
                      const visualAssets = [...prev.visualAssets];
                      visualAssets[vi] = next;
                      return { ...prev, visualAssets };
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* 3. Rewrite Settings */}
      {showExtracted && (
        <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          {sectionTitle("3. Настройки")}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block text-xs text-white/45">
              Режим
              <select
                className={fieldClass()}
                value={settings.rewriteMode}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    rewriteMode: e.target.value as RewriteMode,
                  }))
                }
              >
                {REWRITE_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-white/45">
              Объём результата
              <select
                className={fieldClass()}
                value={settings.outputLength}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    outputLength: e.target.value as OutputLength,
                  }))
                }
              >
                {OUTPUT_LENGTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-white/45">
              Интенсивность
              <select
                className={fieldClass()}
                value={settings.styleIntensity}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    styleIntensity: e.target.value as StyleIntensity,
                  }))
                }
              >
                {STYLE_INTENSITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-white/45">
              Уникализация
              <select
                className={fieldClass()}
                value={settings.plagiarismSafety}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    plagiarismSafety: e.target.value as PlagiarismSafety,
                  }))
                }
              >
                {PLAGIARISM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={!extracted || status === "rewriting"}
            onClick={() => void runRewrite()}
            className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-[#14b8a6]/30 bg-[#14b8a6]/15 px-4 py-2.5 text-sm font-medium text-white transition enabled:hover:border-[#14b8a6]/50 enabled:hover:bg-[#14b8a6]/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "rewriting" && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            {status === "rewriting" ? "Переписываю…" : "Переписать"}
          </button>
        </section>
      )}

      {/* 4. Rewritten Result */}
      {showRewritten && rewritten && (
        <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          {sectionTitle("4. Результат")}
          <label className="mt-3 block text-xs text-white/45">
            Переписанный текст
            <textarea
              className={`${fieldClass()} min-h-[160px]`}
              value={rewritten.fullRewrittenText}
              onChange={(e) =>
                setRewritten((r) =>
                  r ? { ...r, fullRewrittenText: e.target.value } : r
                )
              }
            />
          </label>
          {rewritten.rewrittenPages?.map((p) => (
            <div key={p.pageNumber} className="mt-6 border-t border-white/6 pt-4">
              <p className="text-sm font-semibold text-white">
                СТРАНИЦА {p.pageNumber}
              </p>
              <label className="mt-2 block text-xs text-white/45">
                переписанный текст
                <textarea
                  className={`${fieldClass()} min-h-[100px]`}
                  value={p.rewrittenText}
                  onChange={(e) =>
                    setRewritten((prev) => {
                      if (!prev?.rewrittenPages) return prev;
                      const pages = prev.rewrittenPages.map((x) =>
                        x.pageNumber === p.pageNumber
                          ? { ...x, rewrittenText: e.target.value }
                          : x
                      );
                      return { ...prev, rewrittenPages: pages };
                    })
                  }
                />
              </label>
              <p className="mt-2 text-xs text-white/40">визуальное описание сохранено</p>
              {p.visualAssets.map((a) => (
                <div
                  key={a.id}
                  className="mt-2 rounded border border-white/6 bg-black/20 p-2 text-xs text-white/55"
                >
                  <p className="text-white/70">{a.type}</p>
                  <p className="mt-1 whitespace-pre-wrap">{a.visualDescription}</p>
                </div>
              ))}
            </div>
          ))}
          {rewritten.rewrittenSlides?.map((s) => (
            <div
              key={s.slideNumber}
              className="mt-6 border-t border-white/6 pt-4"
            >
              <p className="text-sm font-semibold text-white">
                СЛАЙД {s.slideNumber}
              </p>
              <label className="mt-2 block text-xs text-white/45">
                переписанный текст
                <textarea
                  className={`${fieldClass()} min-h-[100px]`}
                  value={s.rewrittenText}
                  onChange={(e) =>
                    setRewritten((prev) => {
                      if (!prev?.rewrittenSlides) return prev;
                      const slides = prev.rewrittenSlides.map((x) =>
                        x.slideNumber === s.slideNumber
                          ? { ...x, rewrittenText: e.target.value }
                          : x
                      );
                      return { ...prev, rewrittenSlides: slides };
                    })
                  }
                />
              </label>
              <p className="mt-1 text-xs text-white/40">
                визуальное описание сохранено · заметки: {s.layoutNotes || "—"}
              </p>
              {s.visualAssets.map((a) => (
                <div
                  key={a.id}
                  className="mt-2 rounded border border-white/6 bg-black/20 p-2 text-xs text-white/55"
                >
                  <p className="text-white/70">{a.type}</p>
                  <p className="mt-1 whitespace-pre-wrap">{a.visualDescription}</p>
                </div>
              ))}
            </div>
          ))}
          {rewritten.rewrittenTranscript !== undefined && (
            <label className="mt-4 block text-xs text-white/45">
              Переписанный транскрипт
              <textarea
                className={`${fieldClass()} min-h-[100px]`}
                value={rewritten.rewrittenTranscript ?? ""}
                onChange={(e) =>
                  setRewritten((r) =>
                    r ? { ...r, rewrittenTranscript: e.target.value } : r
                  )
                }
              />
            </label>
          )}
          {rewritten.notes.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-white/45">Заметки</p>
              <ul className="mt-1 list-inside list-disc text-sm text-white/70">
                {rewritten.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 5. Export */}
      {showRewritten && (
        <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          {sectionTitle("5. Экспорт")}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyAll}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              Скопировать всё
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rewritten) return;
                const content =
                  rewritten.fullRewrittenText.trim() ||
                  buildStructuredMarkdown(rewritten);
                downloadBlob(
                  "source-rewriter-result.txt",
                  content,
                  "text/plain;charset=utf-8"
                );
              }}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              Скачать .txt
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rewritten) return;
                const content =
                  rewritten.fullRewrittenText.trim() ||
                  buildStructuredMarkdown(rewritten);
                downloadBlob(
                  "source-rewriter-result.md",
                  content,
                  "text/markdown;charset=utf-8"
                );
              }}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              Скачать .md
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rewritten) return;
                downloadBlob(
                  "source-rewriter-result.json",
                  JSON.stringify(rewritten, null, 2),
                  "application/json"
                );
              }}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              Скачать JSON
            </button>
            <button
              type="button"
              onClick={resetAll}
              className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-100/90 hover:bg-red-500/20"
            >
              Сбросить
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
