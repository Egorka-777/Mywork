import { useRef, useState } from "react";
import { ClipboardCopy, Download, ImageIcon, Loader2 } from "lucide-react";
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

function uploadLabelClass() {
  return "flex cursor-pointer items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/50 transition hover:border-white/15 hover:text-white/70";
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

function buildSourceCarouselGptPromptPack(
  r: RewrittenSource,
  styleNotes: string,
  styleReferenceCount: number,
  hasCharacterReference: boolean
): string {
  const pages = r.rewrittenCarouselPages ?? [];
  const slideCount = pages.length;

  const slideBlocks = pages.map((p) => {
    const role = p.role === "hook" ? "COVER" : p.role === "cta" ? "CTA" : "CONTENT";
    const people = hasCharacterReference
      ? "- Use the attached character/person reference image when a person, face, founder, author, expert or main character is needed. Preserve identity, age range, face structure, hair, gender presentation and realistic proportions."
      : "- none unless the slide text explicitly requires a person";

    return `SLIDE ${p.pageNumber}
ROLE: ${role}
ORIGINAL STRUCTURE: Source Rewriter carousel draft from uploaded source material
TEXT FOR SLIDE:
${p.rewrittenText}

VISUAL DESCRIPTION:
${p.visualPrompt || "Create a clean readable slide based on the slide text."}

VISUAL ELEMENTS:
- Use visual elements that directly explain the slide text.
- Do not add decorative elements that do not support meaning.

PEOPLE:
${people}

BRANDS / TOOLS / PLATFORMS:
- Detect brands, services, apps, tools, neural networks, companies and platforms from the slide text and visual description.
- Use recognizable logos, app icons or minimal stylized symbols when they help explain the meaning.

SCREENSHOT:
- no locked screenshot by default

CHATGPT VISUAL NOTES:
${p.visualPrompt || "- Keep the slide clean, readable and visually connected to the rest of the carousel."}`;
  });

  const styleNotesLine = styleReferenceCount > 0
    ? `Стиль карусели: как на ${styleReferenceCount} прикреплённом(ых) референсе(ах).${styleNotes.trim() ? ` Дополнительно: ${styleNotes.trim()}` : ""}`
    : styleNotes.trim()
      ? `Стиль карусели: ${styleNotes.trim()}`
      : "Стиль карусели: premium clean social carousel, readable, modern, strong hierarchy.";

  const referenceRule = styleReferenceCount > 0
    ? "Референс использовать не как пример темы, а как точный визуальный ориентир. Не описывай стиль — считывай его напрямую с прикреплённого изображения: типографику, сетку, отступы, цвета, разделители, шапку, footer, нумерацию слайдов. Все слайды должны выглядеть как единая серия в точно том же визуальном стиле, что и на референсе."
    : "Если визуальный референс не прикреплён, собери единый современный стиль сам: крупная типографика, сильная иерархия, чистые отступы, аккуратные карточки/акценты, без случайного декора.";

  const characterRule = hasCharacterReference
    ? `

ВАЖНО ПО ПЕРСОНАЖУ:
К сообщению прикреплено изображение персонажа/человека. Если на слайде нужен человек, автор, эксперт, герой или лицо в кадре — используй прикреплённый character reference как главный визуальный ориентир. Сохраняй внешность, пол, возрастной диапазон, причёску, черты лица и узнаваемость. Не меняй идентичность. Если человек на конкретном слайде не нужен по смыслу, не вставляй его принудительно.`
    : "";

  return `Создай мне карусель из ${slideCount} слайдов.

${styleNotesLine}

${referenceRule}${characterRule}

ВАЖНО ПО ВИЗУАЛИЗАЦИИ:
Если в тексте слайда упоминаются:
- нейросети;
- сервисы;
- сайты;
- приложения;
- компании;
- бренды;
- известные люди;
- платформы;
- технологии;

то обязательно добавь визуальные элементы по этим названиям:
- для сервисов, сайтов, приложений и нейросетей: логотипы, иконки, app icons или стилизованные узнаваемые символы;
- для известных людей: портрет / лицо / силуэт / визуальный образ человека;
- для брендов и компаний: логотип или фирменный визуальный знак;
- если точный логотип нельзя использовать или он плохо читается, сделай минималистичную стилизованную иконку рядом с названием;
- визуал должен помогать понять смысл, а не быть декором ради декора.

ОБЩИЕ ПРАВИЛА:
- Формат каждого слайда: вертикальный Instagram carousel, 4:5.
- Каждый слайд должен быть отдельным полноценным изображением.
- Все слайды должны быть в одном стиле.
- Сохраняй точный смысл текста.
- Используй TEXT FOR SLIDE как финальный текст на слайде.
- Не добавляй лишние факты, которых нет в исходном тексте.
- Не меняй названия сервисов, брендов и людей.
- Не сокращай важные названия.
- Если текста много, аккуратно структурируй его в блоки, списки, карточки или колонки.
- Если на слайде список инструментов, сделай его читаемым: номер, иконка/логотип, название, короткое описание.
- Если слайд является обложкой, сделай его максимально цепляющим: крупный заголовок-хук, ощущение секрета/пользы/выгоды, сильный визуальный образ, минимум лишнего.
- Если слайд является финальным CTA, сделай его максимально понятным и конверсионным: крупный вопрос/обещание, действие, ключевое слово для комментария.
- Используй синий цвет для смысловых акцентов: цифры, ключевые слова, CTA, номера слайдов.
- Не перегружай слайды мелким текстом.
- Текст должен быть крупным, читаемым и аккуратно выровненным.
- Не делай мультяшный, детский или шаблонный дизайн.
- Не используй случайные декоративные элементы.
- Не делай дизайн в стиле презентации PowerPoint.
- Не делай кислотные цвета.
- Не делай дешёвые 3D-эффекты.
- Не добавляй водяные знаки.

ДАННЫЕ ДЛЯ СЛАЙДОВ:
${slideBlocks.join("\n\n---\n\n")}`;
}

function buildStructuredMarkdown(r: RewrittenSource, promptOverride?: string): string {
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
    const prompt = promptOverride ?? r.carouselPromptPack ?? "";
    if (prompt.trim()) {
      lines.push("## GPT Prompt Pack", "", prompt, "");
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
  const styleRefFilesRef = useRef<File[]>([]);
  const characterRefFileRef = useRef<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [status, setStatus] = useState<"idle" | "extracting" | "rewriting" | "error">("idle");
  const [extracted, setExtracted] = useState<ExtractedSource | null>(null);
  const [editedSource, setEditedSource] = useState<ExtractedSource | null>(null);
  const [settings, setSettings] = useState<RewriteSettings>(defaultSettings);
  const [rewritten, setRewritten] = useState<RewrittenSource | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [styleRefPreviews, setStyleRefPreviews] = useState<string[]>([]);
  const [characterRefPreview, setCharacterRefPreview] = useState<string | null>(null);
  const [characterRefName, setCharacterRefName] = useState<string>("");

  const showExtracted = extracted !== null && editedSource !== null;
  const showRewritten = rewritten !== null;
  const isCarouselMode = settings.rewriteMode === "carousel_script";

  const getCurrentPromptPack = (source = rewritten) => {
    if (!source) return "";
    if (source.rewrittenCarouselPages?.length) {
      return buildSourceCarouselGptPromptPack(
        source,
        settings.carouselStyleNotes ?? "",
        styleRefPreviews.length,
        Boolean(characterRefPreview)
      );
    }
    return source.carouselPromptPack ?? "";
  };

  const buildCarouselStyleNotesForRequest = () => {
    const notes = [settings.carouselStyleNotes?.trim()].filter(Boolean) as string[];
    if (styleRefPreviews.length > 0) {
      notes.push(`В финальном GPT Prompt Pack пользователь прикрепит ${styleRefPreviews.length} style reference image(s). Prompt должен требовать считать стиль с прикреплённых референсов напрямую.`);
    }
    if (characterRefPreview) {
      notes.push("В финальном GPT Prompt Pack пользователь прикрепит character/person reference image. Prompt должен требовать использовать его только там, где по смыслу нужен персонаж/человек, с сохранением идентичности.");
    }
    return notes.join("\n");
  };

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
      const requestSettings: RewriteSettings = isCarouselMode
        ? { ...settings, carouselStyleNotes: buildCarouselStyleNotesForRequest() }
        : settings;
      const r = await fetch("/wb/source-rewriter/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extractedSource: extracted, editedSource, settings: requestSettings }),
      });
      const data = (await r.json()) as RewrittenSource & { error?: string; raw?: string; detail?: string };
      if (!r.ok) {
        const msg = [data.error, data.detail, data.raw].filter(Boolean).join(" — ");
        throw new Error(msg || `HTTP ${r.status}`);
      }
      setRewritten(
        data.rewrittenCarouselPages?.length
          ? { ...data, carouselPromptPack: buildSourceCarouselGptPromptPack(data, settings.carouselStyleNotes ?? "", styleRefPreviews.length, Boolean(characterRefPreview)) }
          : data
      );
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
    styleRefPreviews.forEach((u) => URL.revokeObjectURL(u));
    if (characterRefPreview) URL.revokeObjectURL(characterRefPreview);
    styleRefFilesRef.current = [];
    characterRefFileRef.current = null;
    setStyleRefPreviews([]);
    setCharacterRefPreview(null);
    setCharacterRefName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const copyAll = () => {
    if (!rewritten) return;
    const prompt = getCurrentPromptPack();
    const text = prompt.trim() || rewritten.fullRewrittenText.trim() || buildStructuredMarkdown(rewritten, prompt).trim();
    copyText(text);
  };

  const copyCarouselPrompt = async () => {
    const prompt = getCurrentPromptPack();
    if (!prompt.trim()) return;
    await navigator.clipboard.writeText(prompt);
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
          Загрузить файл → извлечь текст/транскрипт → собрать карусель и GPT Prompt Pack.
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
        {file && <p className="mt-2 text-xs text-[#5eead4]">Файл выбран: {file.name}</p>}
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
                onChange={(e) => setSettings((s) => ({ ...s, rewriteMode: e.target.value as RewriteMode }))}
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
                Структура Prompt Pack собрана как в Instagram Carousel Remix: style reference → character reference → pages → GPT prompt.
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
                    onChange={(e) => setSettings((s) => ({ ...s, carouselSlideCount: Number(e.target.value) }))}
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
                    onChange={(e) => setSettings((s) => ({ ...s, carouselMaxCharsPerSlide: Number(e.target.value) }))}
                  />
                </label>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-white/50">
                    Style reference <span className="text-white/25">(до 5, только для ChatGPT)</span>
                  </label>
                  <label className={uploadLabelClass()}>
                    <ImageIcon className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {styleRefPreviews.length > 0 ? `${styleRefPreviews.length} reference(s)` : "Загрузить референс стиля…"}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      className="sr-only"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []).slice(0, 5);
                        styleRefFilesRef.current = files;
                        setStyleRefPreviews((prev) => {
                          prev.forEach((u) => URL.revokeObjectURL(u));
                          return files.map((f) => URL.createObjectURL(f));
                        });
                        setCopiedPrompt(false);
                      }}
                    />
                  </label>
                  {styleRefPreviews.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {styleRefPreviews.map((src, i) => (
                        <img key={i} src={src} alt={`style ref ${i + 1}`} className="h-12 w-12 rounded-md border border-white/8 object-cover" />
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-white/50">
                    Character reference <span className="text-white/25">(персонаж/человек)</span>
                  </label>
                  <label className={uploadLabelClass()}>
                    <ImageIcon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{characterRefName || "Загрузить персонажа…"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        characterRefFileRef.current = f;
                        if (characterRefPreview) URL.revokeObjectURL(characterRefPreview);
                        setCharacterRefPreview(f ? URL.createObjectURL(f) : null);
                        setCharacterRefName(f?.name ?? "");
                        setCopiedPrompt(false);
                      }}
                    />
                  </label>
                  {characterRefPreview && (
                    <img src={characterRefPreview} alt="character reference" className="h-12 w-12 rounded-md border border-white/8 object-cover" />
                  )}
                </div>
              </div>

              <label className="mt-4 block text-xs text-white/45">
                Optional style notes <span className="text-white/25">(попадут в prompt pack)</span>
                <textarea
                  className={`${fieldClass()} min-h-[80px]`}
                  placeholder="Дополнительные пожелания по стилю: цвета, настроение, типографика, что не делать."
                  value={settings.carouselStyleNotes ?? ""}
                  onChange={(e) => {
                    setSettings((s) => ({ ...s, carouselStyleNotes: e.target.value }));
                    setCopiedPrompt(false);
                  }}
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
                Готово: карусель разбита на страницы, первая страница — hook, последняя — CTA. Prompt ниже пересобирается по структуре Instagram Carousel Remix и учитывает style/character reference.
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
                          return { ...prev, rewrittenCarouselPages: prev.rewrittenCarouselPages.map((x) => x.pageNumber === p.pageNumber ? { ...x, rewrittenText: val } : x) };
                        });
                        setCopiedPrompt(false);
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
                          return { ...prev, rewrittenCarouselPages: prev.rewrittenCarouselPages.map((x) => x.pageNumber === p.pageNumber ? { ...x, visualPrompt: val } : x) };
                        });
                        setCopiedPrompt(false);
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
                  onChange={(e) => setRewritten((r) => (r ? { ...r, rewrittenCaption: e.target.value } : r))}
                />
              </label>
              <div className="rounded-xl border border-[#5b8def]/20 bg-[#5b8def]/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#9db9ff]">GPT Prompt Pack</p>
                    <p className="mt-1 text-xs text-white/45">
                      При отправке этого промпта в ChatGPT прикрепи выбранные style reference и character reference изображения вручную.
                    </p>
                  </div>
                  <button type="button" onClick={copyCarouselPrompt} className={buttonClass("white")}>
                    <ClipboardCopy className="h-4 w-4" /> {copiedPrompt ? "Скопировано" : "Скопировать prompt"}
                  </button>
                </div>
                {(styleRefPreviews.length > 0 || characterRefPreview) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {styleRefPreviews.map((src, i) => (
                      <img key={`prompt-style-${i}`} src={src} alt={`prompt style ref ${i + 1}`} className="h-14 w-14 rounded-md border border-white/8 object-cover" />
                    ))}
                    {characterRefPreview && (
                      <img src={characterRefPreview} alt="prompt character ref" className="h-14 w-14 rounded-md border border-[#5b8def]/30 object-cover" />
                    )}
                  </div>
                )}
                <textarea
                  readOnly
                  className={`${fieldClass(true)} mt-3 min-h-[220px] font-mono text-xs`}
                  value={getCurrentPromptPack()}
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
                          const pages = prev.rewrittenPages.map((x) => x.pageNumber === p.pageNumber ? { ...x, rewrittenText: e.target.value } : x);
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
                          const slides = prev.rewrittenSlides.map((x) => x.slideNumber === s.slideNumber ? { ...x, rewrittenText: e.target.value } : x);
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
              {getCurrentPromptPack() ? "Скопировать GPT prompt" : "Скопировать всё"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rewritten) return;
                const prompt = getCurrentPromptPack();
                downloadBlob("source-rewriter-result.txt", buildStructuredMarkdown(rewritten, prompt), "text/plain;charset=utf-8");
              }}
              className={buttonClass("white")}
            >
              <Download className="h-4 w-4" /> Скачать .txt
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rewritten) return;
                const prompt = getCurrentPromptPack();
                downloadBlob("source-rewriter-result.md", buildStructuredMarkdown(rewritten, prompt), "text/markdown;charset=utf-8");
              }}
              className={buttonClass("white")}
            >
              <Download className="h-4 w-4" /> Скачать .md
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rewritten) return;
                downloadBlob("source-rewriter-result.json", JSON.stringify({ ...rewritten, carouselPromptPack: getCurrentPromptPack() }, null, 2), "application/json");
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
