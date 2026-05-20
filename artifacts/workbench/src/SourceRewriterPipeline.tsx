import { useRef, useState } from "react";
import { ClipboardCopy, Download, Loader2 } from "lucide-react";
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
  { value: "carousel_script", label: "Преобразовать в сценарий карусели" },
  { value: "preserve_original_structure", label: "Сохранить исходную структуру" },
  { value: "storytelling_text", label: "Преобразовать в сторителлинг" },
  { value: "presentation_text", label: "Преобразовать в текст презентации" },
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
  rewriteMode: "carousel_script",
  outputLength: "keep_similar_length",
  styleIntensity: "strong_rewrite",
  plagiarismSafety: "strong_uniqueness",
  carouselSlideCount: 6,
  carouselMaxCharsPerSlide: 140,
  carouselStyleNotes: "",
  carouselCtaText: "Сохрани этот пост и отправь тому, кому это пригодится.",
};

function fieldClass(readonly = false) {
  return `mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#14b8a6]/50 focus:outline-none ${readonly ? "opacity-80" : ""}`;
}

function buttonClass(accent: "teal" | "white" | "red" = "white") {
  if (accent === "teal") {
    return "flex items-center justify-center gap-2 rounded-xl border border-[#14b8a6]/30 bg-[#14b8a6]/15 px-4 py-2.5 text-sm font-medium text-white transition enabled:hover:border-[#14b8a6]/50 enabled:hover:bg-[#14b8a6]/25 disabled:cursor-not-allowed disabled:opacity-40";
  }
  if (accent === "red") {
    return "rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-100/90 hover:bg-red-500/20";
  }
  return "flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10";
}

function sectionTitle(text: string) {
  return (
    <h3 className="font-sans text-sm font-semibold tracking-wide text-white/90 uppercase">
      {text}
    </h3>
  );
}

function roleLabel(role: string) {
  if (role === "hook") return "HOOK / ОБЛОЖКА";
  if (role === "cta") return "CTA / ФИНАЛ";
  return "CONTENT";
}

function buildStructuredMarkdown(r: RewrittenSource): string {
  const lines: string[] = ["# Переписанный материал", ""];
  if (r.rewrittenCarouselPages?.length) {
    lines.push("## Карусель", "");
    for (const p of r.rewrittenCarouselPages) {
      lines.push(`### Страница ${p.pageNumber} — ${roleLabel(p.role)}`, "", p.rewrittenText, "");
      if (p.visualPrompt.trim()) {
        lines.push("Визуальное ТЗ:", p.visualPrompt, "");
      }
    }
    if (r.rewrittenCaption?.trim()) {
      lines.push("## Подпись", "", r.rewrittenCaption, "");
    }
    if (r.carouselPromptPack?.trim()) {
      lines.push("## GPT Prompt Pack", "", r.carouselPromptPack, "");
    }
    return lines.join("\n");
  }
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
  lines.push(r.fullRewrittenText);
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
            set({ type: e.target.value as ExtractedVisualDescription["type"] })
          }
        >
          {(["photo", "screenshot", "chart", "graphic", "ui", "unknown"] as const).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      {([
        ["visibleText", "видимый текст"],
        ["visualDescription", "визуальное описание"],
        ["styleDescription", "описание стиля"],
        ["clothing", "одежда"],
        ["accessoriesAndProps", "аксессуары и реквизит"],
        ["lighting", "освещение"],
        ["background", "фон"],
        ["composition", "композиция"],
      ] as const).map(([key, label]) => (
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
            set({ colors: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
          }
        />
      </label>
      <label className="block text-xs text-white/45">
        заметки для воссоздания (по одному)
        <textarea
          className={`${fieldClass()} min-h-[52px]`}
          value={asset.recreationNotes.join("\n")}
          onChange={(e) =>
            set({ recreationNotes: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
          }
        />
      </label>
    </div>
  );
}

export function SourceRewriterPipeline() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [status, setStatus] = useState<"idle" | "extracting" | "rewriting" | "error">("idle");
  const [extracted, setExtracted] = useState<ExtractedSource | null>(null);
  const [editedSource, setEditedSource] = useState<ExtractedSource | null>(null);
  const [settings, setSettings] = useState<RewriteSettings>(defaultSettings);
  const [rewritten, setRewritten] = useState<RewrittenSource | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const showExtracted = extracted !== null && editedSource !== null;
  const showRewritten = rewritten !== null;
  const isCarouselMode = settings.rewriteMode === "carousel_script";

  const runExtract = async () => {
    if (!file) return;
    setStatus("idle");
    setErrorText(null);
    setExtracted(null);
    setEditedSource(null);
    setRewritten(null);
    setCopiedPrompt(false);
    setStatus("extracting");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/wb/source-rewriter/extract", { method: "POST", body: fd });
      const data = (await r.json()) as ExtractedSource & { error?: string; detail?: string; raw?: string };
      if (!r.ok) {
        const msg = [data.error, data.detail, data.raw].filter(Boolean).join(" — ");
        throw new Error(msg || `HTTP ${r.status}`);
      }
      setExtracted(data);
      setEditedSource(structuredClone(data));
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrorText(e instanceof Error ? e.message : String(e));
    }
  };

  const runRewrite = async () => {
    if (!extracted || !editedSource) return;
    setErrorText(null);
    setCopiedPrompt(false);
    setStatus("rewriting");
    try {
      const r = await fetch("/wb/source-rewriter/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extractedSource: extracted, editedSource, settings }),
      });
      const data = (await r.json()) as RewrittenSource & { error?: string; raw?: string; detail?: string };
      if (!r.ok) {
        const msg = [data.error, data.detail, data.raw].filter(Boolean).join(" — ");
        throw new Error(msg || `HTTP ${r.status}`);
      }
      setRewritten(data);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrorText(e instanceof Error ? e.message : String(e));
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
    setCopiedPrompt(false);
    setStatus("idle");
    if (fileRef.current) fileRef.current.value = "";
  };

  const copyAll = () => {
    if (!rewritten) return;
    const text = rewritten.carouselPromptPack?.trim() || rewritten.fullRewrittenText.trim() || buildStructuredMarkdown(rewritten).trim();
    copyText(text);
  };

  const copyCarouselPrompt = async () => {
    if (!rewritten?.carouselPromptPack?.trim()) return;
    await navigator.clipboard.writeText(rewritten.carouselPromptPack);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 1800);
  };

  const setEdited = (updater: (e: ExtractedSource) => ExtractedSource) => {
    setEditedSource((prev) => (prev ? updater(prev) : prev));
  };

  return (
    <div className="flex flex-col gap-8">
      {errorText && (
        <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/95">
          {errorText}
        </div>
      )}

      <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
        {sectionTitle("1. Источник")}
        <p className="mt-2 text-xs text-white/40">
          Сейчас рабочий owner-режим: загрузить файл → извлечь текст/транскрипт → собрать карусель и GPT Prompt Pack.
        </p>
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
            setCopiedPrompt(false);
          }}
        />
        {file && (
          <p className="mt-2 text-xs text-[#5eead4]">Файл выбран: {file.name}</p>
        )}
        <button
          type="button"
          disabled={!file || status === "extracting"}
          onClick={() => void runExtract()}
          className={`mt-4 ${buttonClass("teal")}`}
        >
          {status === "extracting" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {status === "extracting" ? "Извлекаю текст и транскрипт…" : "Извлечь"}
        </button>
      </section>

      {showExtracted && editedSource && (
        <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          {sectionTitle("2. Извлечённый материал")}
          <div className="mt-3 grid gap-2 text-sm text-white/60">
            <p><span className="text-white/40">Файл:</span> {editedSource.fileName}</p>
            <p><span className="text-white/40">Тип:</span> {editedSource.fileType}</p>
          </div>
          {editedSource.extractionWarnings.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-sm text-amber-200/90">
              {editedSource.extractionWarnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <label className="mt-4 block text-xs text-white/45">
            Полный текст
            <textarea
              className={`${fieldClass()} min-h-[140px] font-mono text-xs`}
              value={editedSource.fullRawText}
              onChange={(e) => setEdited((prev) => ({ ...prev, fullRawText: e.target.value }))}
            />
          </label>
          {editedSource.transcript !== undefined && (
            <label className="mt-3 block text-xs text-white/45">
              Транскрипт
              <textarea
                className={`${fieldClass()} min-h-[100px] font-mono text-xs`}
                value={editedSource.transcript ?? ""}
                onChange={(e) => setEdited((prev) => ({ ...prev, transcript: e.target.value }))}
              />
            </label>
          )}
          {editedSource.pages?.map((page, pi) => (
            <div key={page.pageNumber} className="mt-6 border-t border-white/6 pt-4">
              <p className="text-sm font-semibold text-white">СТРАНИЦА {page.pageNumber}</p>
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
            <div key={slide.slideNumber} className="mt-6 border-t border-white/6 pt-4">
              <p className="text-sm font-semibold text-white">СЛАЙД {slide.slideNumber}</p>
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

      {showExtracted && (
        <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          {sectionTitle("3. Настройки рерайта")}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block text-xs text-white/45">
              Режим
              <select
                className={fieldClass()}
                value={settings.rewriteMode}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, rewriteMode: e.target.value as RewriteMode }))
                }
              >
                {REWRITE_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-white/45">
              Объём результата
              <select
                className={fieldClass()}
                value={settings.outputLength}
                onChange={(e) => setSettings((s) => ({ ...s, outputLength: e.target.value as OutputLength }))}
              >
                {OUTPUT_LENGTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-white/45">
              Интенсивность
              <select
                className={fieldClass()}
                value={settings.styleIntensity}
                onChange={(e) => setSettings((s) => ({ ...s, styleIntensity: e.target.value as StyleIntensity }))}
              >
                {STYLE_INTENSITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-white/45">
              Уникализация
              <select
                className={fieldClass()}
                value={settings.plagiarismSafety}
                onChange={(e) => setSettings((s) => ({ ...s, plagiarismSafety: e.target.value as PlagiarismSafety }))}
              >
                {PLAGIARISM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>

          {isCarouselMode && (
            <div className="mt-5 rounded-xl border border-[#14b8a6]/20 bg-[#14b8a6]/5 p-4">
              <p className="text-sm font-semibold text-[#5eead4]">Карусельный режим включён</p>
              <p className="mt-1 text-xs text-white/45">
                Backend обязан вернуть страницы с ролями hook/content/cta и готовый GPT Prompt Pack.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block text-xs text-white/45">
                  Количество страниц
                  <input
                    type="number"
                    min={3}
                    max={10}
                    className={fieldClass()}
                    value={settings.carouselSlideCount ?? 6}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, carouselSlideCount: Number(e.target.value) }))
                    }
                  />
                </label>
                <label className="block text-xs text-white/45">
                  Максимум символов на слайд
                  <input
                    type="number"
                    min={60}
                    max={260}
                    className={fieldClass()}
                    value={settings.carouselMaxCharsPerSlide ?? 140}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, carouselMaxCharsPerSlide: Number(e.target.value) }))
                    }
                  />
                </label>
              </div>
              <label className="mt-4 block text-xs text-white/45">
                Стиль / референс / персонаж для GPT Prompt Pack
                <textarea
                  className={`${fieldClass()} min-h-[80px]`}
                  placeholder="Например: использовать мой прикреплённый портрет как главного персонажа; стиль — тёмный premium minimalism; акценты — синий/бирюзовый; без мелкого текста."
                  value={settings.carouselStyleNotes ?? ""}
                  onChange={(e) => setSettings((s) => ({ ...s, carouselStyleNotes: e.target.value }))}
                />
              </label>
              <label className="mt-4 block text-xs text-white/45">
                CTA для последней страницы
                <input
                  className={fieldClass()}
                  value={settings.carouselCtaText ?? ""}
                  onChange={(e) => setSettings((s) => ({ ...s, carouselCtaText: e.target.value }))}
                />
              </label>
            </div>
          )}

          <button
            type="button"
            disabled={!extracted || status === "rewriting"}
            onClick={() => void runRewrite()}
            className={`mt-4 ${buttonClass("teal")}`}
          >
            {status === "rewriting" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {status === "rewriting" ? "Собираю результат…" : isCarouselMode ? "Собрать карусель + GPT Prompt Pack" : "Переписать"}
          </button>
        </section>
      )}

      {showRewritten && rewritten && (
        <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          {sectionTitle("4. Результат")}

          {rewritten.rewrittenCarouselPages?.length ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#14b8a6]/20 bg-[#14b8a6]/5 p-3 text-sm text-white/75">
                Готово: карусель разбита на страницы, первая страница — hook, последняя — CTA. Ниже готовый текст и визуальные ТЗ для каждого слайда.
              </div>
              {rewritten.rewrittenCarouselPages.map((p) => (
                <div key={p.pageNumber} className="rounded-xl border border-white/8 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">СТРАНИЦА {p.pageNumber}</p>
                    <span className="rounded-full border border-[#14b8a6]/30 bg-[#14b8a6]/10 px-2 py-0.5 text-[10px] font-semibold text-[#5eead4]">
                      {roleLabel(p.role)}
                    </span>
                  </div>
                  <label className="mt-3 block text-xs text-white/45">
                    текст на слайде
                    <textarea
                      className={`${fieldClass()} min-h-[90px]`}
                      value={p.rewrittenText}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRewritten((prev) => {
                          if (!prev?.rewrittenCarouselPages) return prev;
                          return {
                            ...prev,
                            rewrittenCarouselPages: prev.rewrittenCarouselPages.map((x) =>
                              x.pageNumber === p.pageNumber ? { ...x, rewrittenText: val } : x
                            ),
                          };
                        });
                      }}
                    />
                  </label>
                  <label className="mt-3 block text-xs text-white/45">
                    визуальное ТЗ для слайда
                    <textarea
                      className={`${fieldClass()} min-h-[80px]`}
                      value={p.visualPrompt}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRewritten((prev) => {
                          if (!prev?.rewrittenCarouselPages) return prev;
                          return {
                            ...prev,
                            rewrittenCarouselPages: prev.rewrittenCarouselPages.map((x) =>
                              x.pageNumber === p.pageNumber ? { ...x, visualPrompt: val } : x
                            ),
                          };
                        });
                      }}
                    />
                  </label>
                </div>
              ))}
              <label className="block text-xs text-white/45">
                Подпись к публикации
                <textarea
                  className={`${fieldClass()} min-h-[100px]`}
                  value={rewritten.rewrittenCaption ?? ""}
                  onChange={(e) =>
                    setRewritten((r) => (r ? { ...r, rewrittenCaption: e.target.value } : r))
                  }
                />
              </label>
              <div className="rounded-xl border border-[#5b8def]/20 bg-[#5b8def]/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#9db9ff]">GPT Prompt Pack</p>
                    <p className="mt-1 text-xs text-white/45">
                      Это готовый промпт для ChatGPT/генератора карусели. Сюда уже собраны тексты страниц, роли, визуальные ТЗ и стиль.
                    </p>
                  </div>
                  <button type="button" onClick={copyCarouselPrompt} className={buttonClass("white")}>
                    <ClipboardCopy className="h-4 w-4" /> {copiedPrompt ? "Скопировано" : "Скопировать prompt"}
                  </button>
                </div>
                <textarea
                  readOnly
                  className={`${fieldClass(true)} mt-3 min-h-[220px] font-mono text-xs`}
                  value={rewritten.carouselPromptPack ?? ""}
                />
              </div>
            </div>
          ) : (
            <>
              <label className="mt-3 block text-xs text-white/45">
                Переписанный текст
                <textarea
                  className={`${fieldClass()} min-h-[160px]`}
                  value={rewritten.fullRewrittenText}
                  onChange={(e) => setRewritten((r) => (r ? { ...r, fullRewrittenText: e.target.value } : r))}
                />
              </label>
              {rewritten.rewrittenPages?.map((p) => (
                <div key={p.pageNumber} className="mt-6 border-t border-white/6 pt-4">
                  <p className="text-sm font-semibold text-white">СТРАНИЦА {p.pageNumber}</p>
                  <label className="mt-2 block text-xs text-white/45">
                    переписанный текст
                    <textarea
                      className={`${fieldClass()} min-h-[100px]`}
                      value={p.rewrittenText}
                      onChange={(e) =>
                        setRewritten((prev) => {
                          if (!prev?.rewrittenPages) return prev;
                          const pages = prev.rewrittenPages.map((x) =>
                            x.pageNumber === p.pageNumber ? { ...x, rewrittenText: e.target.value } : x
                          );
                          return { ...prev, rewrittenPages: pages };
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              {rewritten.rewrittenSlides?.map((s) => (
                <div key={s.slideNumber} className="mt-6 border-t border-white/6 pt-4">
                  <p className="text-sm font-semibold text-white">СЛАЙД {s.slideNumber}</p>
                  <label className="mt-2 block text-xs text-white/45">
                    переписанный текст
                    <textarea
                      className={`${fieldClass()} min-h-[100px]`}
                      value={s.rewrittenText}
                      onChange={(e) =>
                        setRewritten((prev) => {
                          if (!prev?.rewrittenSlides) return prev;
                          const slides = prev.rewrittenSlides.map((x) =>
                            x.slideNumber === s.slideNumber ? { ...x, rewrittenText: e.target.value } : x
                          );
                          return { ...prev, rewrittenSlides: slides };
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              {rewritten.rewrittenTranscript !== undefined && (
                <label className="mt-4 block text-xs text-white/45">
                  Переписанный транскрипт
                  <textarea
                    className={`${fieldClass()} min-h-[100px]`}
                    value={rewritten.rewrittenTranscript ?? ""}
                    onChange={(e) => setRewritten((r) => (r ? { ...r, rewrittenTranscript: e.target.value } : r))}
                  />
                </label>
              )}
            </>
          )}

          {rewritten.notes.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-white/45">Заметки</p>
              <ul className="mt-1 list-inside list-disc text-sm text-white/70">
                {rewritten.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {showRewritten && (
        <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          {sectionTitle("5. Экспорт")}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={copyAll} className={buttonClass("white")}>
              <ClipboardCopy className="h-4 w-4" />
              {rewritten?.carouselPromptPack ? "Скопировать GPT prompt" : "Скопировать всё"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rewritten) return;
                const content = buildStructuredMarkdown(rewritten);
                downloadBlob("source-rewriter-result.txt", content, "text/plain;charset=utf-8");
              }}
              className={buttonClass("white")}
            >
              <Download className="h-4 w-4" /> Скачать .txt
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rewritten) return;
                downloadBlob("source-rewriter-result.md", buildStructuredMarkdown(rewritten), "text/markdown;charset=utf-8");
              }}
              className={buttonClass("white")}
            >
              <Download className="h-4 w-4" /> Скачать .md
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rewritten) return;
                downloadBlob("source-rewriter-result.json", JSON.stringify(rewritten, null, 2), "application/json");
              }}
              className={buttonClass("white")}
            >
              Скачать JSON
            </button>
            <button type="button" onClick={resetAll} className={buttonClass("red")}>Сбросить</button>
          </div>
        </section>
      )}
    </div>
  );
}
