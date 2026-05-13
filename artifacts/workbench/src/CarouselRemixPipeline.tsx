import { useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  ClipboardCopy,
  Download,
  ImageIcon,
  Link2,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  XCircle,
} from "lucide-react";

type ImportedSlide = {
  slideIndex: number;
  imageUrl: string;
  type: "image" | "video" | "unknown";
};

type SlideAnalysis = {
  slideIndex: number;
  sourceImageUrl: string | null;
  originalText: string;
  rewrittenText: string;
  visualDescription: string;
  hasFace: boolean;
  hasScreenshot: boolean;
  hasText: boolean;
  slideRole: "cover" | "content" | "cta" | "unknown";
  mentionedPeople: string[];
  mentionedBrands: string[];
  mentionedTools: string[];
  mentionedPlatforms: string[];
  visualElements: string[];
  screenshotDescription: string;
  promptVisualHints: string[];
  preserveNotes: string[];
  generationPrompt: string;
  generatedImageUrl: string | null;
  error: string | null;
};

type PipelineStatus =
  | "idle"
  | "importing"
  | "analyzing"
  | "rewriting"
  | "publishing"
  | "done"
  | "error";

const INITIAL_STATE = {
  instagramUrl: "",
  caption: "",
  style: "",
  styleNotes: "",
  importedSlides: [] as ImportedSlide[],
  importError: null as string | null,
  analyses: [] as SlideAnalysis[],
  rewrittenCaption: "",
  gptPrompt: "",
  finalCaption: "",
  finalSlideCountError: null as string | null,
  publishResult: null as { publishId?: string; status?: string; permalink?: string } | null,
  publishError: null as string | null,
  status: "idle" as PipelineStatus,
  statusMessage: "",
};

function buildGptPromptPack(analyses: SlideAnalysis[], styleNotes: string): string {
  const slideCount = analyses.length;

  const slideBlocks = analyses.map((a) => {
    const people =
      a.mentionedPeople.length > 0
        ? a.mentionedPeople.map((p) => `- ${p}`).join("\n")
        : "- none";
    const allBrandsList = [
      ...a.mentionedBrands,
      ...a.mentionedTools,
      ...a.mentionedPlatforms,
    ];
    const brandsToolsPlatforms =
      allBrandsList.length > 0
        ? allBrandsList.map((b) => `- ${b}`).join("\n")
        : "- none";
    const visualElementsStr =
      a.visualElements.length > 0
        ? a.visualElements.map((v) => `- ${v}`).join("\n")
        : "- none";
    const visualHintsStr =
      a.promptVisualHints.length > 0
        ? a.promptVisualHints.map((h) => `- ${h}`).join("\n")
        : "- none";
    const screenshotStr = a.hasScreenshot
      ? `- yes\n- Screenshot description: ${a.screenshotDescription || "n/a"}`
      : "- no";
    const originalStructure =
      a.visualElements.length > 0
        ? a.visualElements.slice(0, 3).join(" + ")
        : a.visualDescription.split(".")[0] || "unknown";

    return `SLIDE ${a.slideIndex}
ROLE: ${a.slideRole.toUpperCase()}
ORIGINAL STRUCTURE: ${originalStructure}
TEXT FOR SLIDE:
${a.rewrittenText || a.originalText}

VISUAL DESCRIPTION:
${a.visualDescription}

VISUAL ELEMENTS:
${visualElementsStr}

PEOPLE:
${people}

BRANDS / TOOLS / PLATFORMS:
${brandsToolsPlatforms}

SCREENSHOT:
${screenshotStr}

CHATGPT VISUAL NOTES:
${visualHintsStr}`;
  });

  const styleNotesLine = styleNotes.trim()
    ? `Стиль карусели: как на прикреплённом референсе. Дополнительно: ${styleNotes.trim()}`
    : "Стиль карусели: как на прикреплённом референсе.";

  return `Создай мне карусель из ${slideCount} слайдов.

${styleNotesLine}

Референс использовать не как пример темы, а как точный визуальный ориентир:
- премиальный editorial-дизайн;
- строгая сетка;
- крупная жирная condensed-типографика;
- высокий контраст;
- основные цвета: чёрный, белый, насыщенный синий;
- минимализм, воздух, аккуратные линии, разделители;
- номера слайдов в формате 01, 02, 03;
- маленькая авторская шапка;
- нижняя служебная линия / footer / стрелка;
- современный стиль личного бренда / экспертного PDF / premium carousel;
- все слайды должны выглядеть как одна серия.

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
- Не добавляй лишние факты, которых нет в исходном тексте.
- Не меняй названия сервисов, брендов и людей.
- Не сокращай важные названия.
- Если текста много, аккуратно структурируй его в блоки, списки, карточки или колонки.
- Если на слайде список инструментов, сделай его читаемым: номер, иконка/логотип, название, короткое описание.
- Если слайд является обложкой, сделай его максимально цепляющим: крупный заголовок -хук, который воспринимается так, будто это раскрывается какой то секрет, и сейчас будешь мясо полезной информации, или какая то жесткая польза будет, сильный визуальный образ, минимум лишнего.
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

function Badge({ label, color }: { label: string; color: string }) {
  const styles: Record<string, string> = {
    blue: "border-[#5b8def]/30 bg-[#5b8def]/10 text-[#5b8def]",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    purple: "border-[#c27aff]/30 bg-[#c27aff]/10 text-[#c27aff]",
    green: "border-[#3ecf8e]/30 bg-[#3ecf8e]/10 text-[#3ecf8e]",
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[color] ?? styles.blue}`}
    >
      {label}
    </span>
  );
}

function StatusIcon({
  status,
}: {
  status: PipelineStatus | "running" | "done" | "error";
}) {
  if (
    ["running", "importing", "analyzing", "rewriting", "publishing"].includes(status)
  )
    return <Loader2 className="h-4 w-4 animate-spin text-[#5b8def]" />;
  if (status === "done") return <CheckCircle className="h-4 w-4 text-[#3ecf8e]" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-amber-400" />;
  return null;
}

export function CarouselRemixPipeline() {
  const [s, setS] = useState(INITIAL_STATE);
  const manualFilesRef = useRef<File[]>([]);
  const styleRefFilesRef = useRef<File[]>([]);
  const finalSlidesRef = useRef<File[]>([]);

  const [manualFileNames, setManualFileNames] = useState<string[]>([]);
  const [styleRefPreviews, setStyleRefPreviews] = useState<string[]>([]);
  const [finalSlidePreviews, setFinalSlidePreviews] = useState<string[]>([]);
  const [finalSlideNames, setFinalSlideNames] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const setStatus = (status: PipelineStatus, msg = "") =>
    setS((p) => ({ ...p, status, statusMessage: msg }));

  // ── import ──────────────────────────────────────────────────────────────────

  const runImport = async () => {
    if (!s.instagramUrl.trim()) return;
    setS((p) => ({
      ...p,
      status: "importing",
      statusMessage: "Импортирую через Apify…",
      importError: null,
      importedSlides: [],
    }));
    try {
      const r = await fetch("/wb/carousel/import-instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: s.instagramUrl.trim() }),
      });
      const d = (await r.json()) as {
        ok?: boolean;
        caption?: string;
        slides?: ImportedSlide[];
        error?: string;
        detail?: string;
      };
      if (!r.ok || !d.ok)
        throw new Error(
          d.error ? `${d.error}${d.detail ? ` — ${d.detail}` : ""}` : "Import failed"
        );
      setS((p) => ({
        ...p,
        status: "idle",
        statusMessage: "",
        caption: d.caption ?? p.caption,
        importedSlides: d.slides ?? [],
        importError: null,
      }));
    } catch (e) {
      setS((p) => ({
        ...p,
        status: "idle",
        statusMessage: "",
        importError: e instanceof Error ? e.message : String(e),
        importedSlides: [],
      }));
    }
  };

  // ── analyze ─────────────────────────────────────────────────────────────────

  const runAnalyze = async () => {
    const hasImported = s.importedSlides.length > 0;
    const hasManual = manualFilesRef.current.length > 0;
    if (!hasImported && !hasManual) return;

    setStatus("analyzing", "Анализирую слайды…");
    try {
      let r: Response;
      if (hasImported) {
        r = await fetch("/wb/carousel/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caption: s.caption,
            imageUrls: s.importedSlides.map((sl) => sl.imageUrl),
          }),
        });
      } else {
        const fd = new FormData();
        fd.append("caption", s.caption);
        for (const f of manualFilesRef.current) fd.append("slides", f);
        r = await fetch("/wb/carousel/analyze", { method: "POST", body: fd });
      }
      const d = (await r.json()) as {
        ok?: boolean;
        slides?: SlideAnalysis[];
        error?: string;
      };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Analysis failed");

      const merged = (d.slides ?? []).map((sl) => ({
        ...sl,
        rewrittenText: "",
        generatedImageUrl: null,
        error: null,
        sourceImageUrl:
          s.importedSlides.find((i) => i.slideIndex === sl.slideIndex)?.imageUrl ?? null,
      }));
      setS((p) => ({ ...p, status: "idle", statusMessage: "", analyses: merged }));
    } catch (e) {
      setStatus("error", e instanceof Error ? e.message : String(e));
    }
  };

  // ── rewrite ─────────────────────────────────────────────────────────────────

  const runRewrite = async () => {
    if (s.analyses.length === 0) return;
    setStatus("rewriting", "Переписываю текст…");
    try {
      const r = await fetch("/wb/carousel/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: s.caption, style: s.style, slides: s.analyses }),
      });
      const d = (await r.json()) as {
        ok?: boolean;
        slides?: {
          slideIndex: number;
          rewrittenText: string;
          generationPrompt: string;
        }[];
        rewrittenCaption?: string;
        error?: string;
      };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Rewrite failed");

      const updatedAnalyses = s.analyses.map((a) => {
        const match = (d.slides ?? []).find((sl) => sl.slideIndex === a.slideIndex);
        return match
          ? { ...a, rewrittenText: match.rewrittenText, generationPrompt: match.generationPrompt }
          : a;
      });
      setS((p) => ({
        ...p,
        status: "idle",
        statusMessage: "",
        analyses: updatedAnalyses,
        rewrittenCaption: d.rewrittenCaption ?? "",
        finalCaption: d.rewrittenCaption ?? p.finalCaption,
      }));
    } catch (e) {
      setStatus("error", e instanceof Error ? e.message : String(e));
    }
  };

  // ── build GPT prompt ─────────────────────────────────────────────────────────

  const runBuildPrompt = () => {
    const prompt = buildGptPromptPack(s.analyses, s.styleNotes);
    setS((p) => ({ ...p, gptPrompt: prompt }));
  };

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(s.gptPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadPrompt = () => {
    const blob = new Blob([s.gptPrompt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "carousel-gpt-prompt.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── final slides ─────────────────────────────────────────────────────────────

  const handleFinalSlidesChange = (files: File[]) => {
    finalSlidesRef.current = files;
    setFinalSlidePreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return files.map((f) => URL.createObjectURL(f));
    });
    setFinalSlideNames(files.map((f) => f.name));

    const expectedCount = s.analyses.length || s.importedSlides.length;
    let countError: string | null = null;
    if (files.length < 2 || files.length > 10) {
      countError = `Instagram carousel requires 2–10 slides. Got ${files.length}.`;
    } else if (expectedCount > 0 && files.length !== expectedCount) {
      countError = `Uploaded slides count must match imported carousel slide count. Expected ${expectedCount}, got ${files.length}.`;
    }
    setS((p) => ({ ...p, finalSlideCountError: countError }));
  };

  // ── publish ──────────────────────────────────────────────────────────────────

  const runPublish = async () => {
    if (finalSlidesRef.current.length === 0) return;
    if (s.finalSlideCountError) return;
    if (!s.finalCaption.trim()) return;

    setStatus("publishing", "Загружаю слайды в хранилище…");
    setS((p) => ({ ...p, publishError: null, publishResult: null }));

    try {
      const uploadFd = new FormData();
      for (const f of finalSlidesRef.current) uploadFd.append("finalSlides", f);
      const uploadRes = await fetch("/wb/carousel/upload-final-assets", {
        method: "POST",
        body: uploadFd,
      });
      const uploadData = (await uploadRes.json()) as {
        ok?: boolean;
        urls?: string[];
        error?: string;
      };
      if (!uploadRes.ok || !uploadData.ok)
        throw new Error(uploadData.error ?? "Upload failed");

      setS((p) => ({ ...p, statusMessage: "Публикую карусель в Instagram…" }));

      const pubRes = await fetch("/wb/carousel/publish-instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: s.finalCaption, imageUrls: uploadData.urls }),
      });
      const pubData = (await pubRes.json()) as {
        ok?: boolean;
        publishId?: string;
        status?: string;
        permalink?: string;
        error?: string;
      };
      if (!pubRes.ok || !pubData.ok) throw new Error(pubData.error ?? "Publish failed");

      setS((p) => ({
        ...p,
        status: "done",
        statusMessage: "Карусель опубликована!",
        publishResult: {
          publishId: pubData.publishId,
          status: pubData.status,
          permalink: pubData.permalink,
        },
      }));
    } catch (e) {
      setS((p) => ({
        ...p,
        status: "idle",
        statusMessage: "",
        publishError: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  // ── reset ────────────────────────────────────────────────────────────────────

  const reset = () => {
    setS(INITIAL_STATE);
    manualFilesRef.current = [];
    styleRefFilesRef.current = [];
    finalSlidesRef.current = [];
    setManualFileNames([]);
    setStyleRefPreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
    setFinalSlidePreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
    setFinalSlideNames([]);
    setCopied(false);
  };

  // ── derived ──────────────────────────────────────────────────────────────────

  const isImporting = s.status === "importing";
  const isAnalyzing = s.status === "analyzing";
  const isRewriting = s.status === "rewriting";
  const isPublishing = s.status === "publishing";
  const isBusy = isImporting || isAnalyzing || isRewriting || isPublishing;

  const canAnalyze =
    (s.importedSlides.length > 0 || manualFilesRef.current.length > 0) && !isBusy;
  const canRewrite = s.analyses.length > 0 && !isBusy;
  const canBuildPrompt = s.analyses.some((a) => a.rewrittenText.trim()) && !isBusy;
  const canPublish =
    finalSlidesRef.current.length > 0 &&
    !s.finalSlideCountError &&
    s.finalCaption.trim().length > 0 &&
    !isBusy;

  const expectedSlideCount = s.analyses.length || s.importedSlides.length;

  return (
    <div className="space-y-6">
      {/* breadcrumb */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/30">
        <Link2 className="h-3 w-3" />
        <span>Instagram</span>
        <ArrowRight className="h-3 w-3" />
        <span>Apify</span>
        <ArrowRight className="h-3 w-3" />
        <Sparkles className="h-3 w-3" />
        <span>AI анализ</span>
        <ArrowRight className="h-3 w-3" />
        <span>Рерайт</span>
        <ArrowRight className="h-3 w-3" />
        <span>ChatGPT Prompt</span>
        <ArrowRight className="h-3 w-3" />
        <Send className="h-3 w-3" />
        <span>Публикация</span>
      </div>

      {/* status banner */}
      {s.statusMessage && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            s.status === "error"
              ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
              : s.status === "done"
              ? "border-[#3ecf8e]/20 bg-[#3ecf8e]/5 text-[#3ecf8e]"
              : "border-[#5b8def]/20 bg-[#5b8def]/5 text-[#5b8def]"
          }`}
        >
          <StatusIcon status={s.status} />
          <span>{s.statusMessage}</span>
        </div>
      )}

      {/* ── 1. SOURCE ────────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30">1. Source</p>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-white/50">Instagram URL</label>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-[#5b8def]/50 focus:ring-1 focus:ring-[#5b8def]/30"
              placeholder="https://www.instagram.com/p/..."
              value={s.instagramUrl}
              onChange={(e) => setS((p) => ({ ...p, instagramUrl: e.target.value }))}
              disabled={isImporting}
            />
            <button
              type="button"
              onClick={runImport}
              disabled={!s.instagramUrl.trim() || isImporting}
              className="whitespace-nowrap rounded-xl border border-[#5b8def]/30 bg-[#5b8def]/10 px-4 py-2 text-sm font-medium text-[#5b8def] transition hover:bg-[#5b8def]/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isImporting ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Импорт…
                </span>
              ) : (
                "Import from Instagram"
              )}
            </button>
          </div>
          {s.importError && (
            <p className="text-xs text-amber-400/90">
              Import failed: {s.importError}. Upload slide images manually.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-white/50">Caption</label>
          <textarea
            className="w-full resize-none rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-white/90 placeholder-white/20 outline-none focus:border-[#5b8def]/50 focus:ring-1 focus:ring-[#5b8def]/30"
            rows={3}
            placeholder="Подпись к посту (заполнится автоматически при импорте)…"
            value={s.caption}
            onChange={(e) => setS((p) => ({ ...p, caption: e.target.value }))}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-white/50">Style (для рерайта)</label>
          <input
            className="w-full rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-[#5b8def]/50 focus:ring-1 focus:ring-[#5b8def]/30"
            placeholder="Стиль рерайта: коротко, по делу, без воды…"
            value={s.style}
            onChange={(e) => setS((p) => ({ ...p, style: e.target.value }))}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-white/50">Manual slide upload</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/50 transition hover:border-white/15 hover:text-white/70">
              <ImageIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {manualFileNames.length > 0
                  ? `${manualFileNames.length} файл(ов)`
                  : "Выбрать изображения…"}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  manualFilesRef.current = files;
                  setManualFileNames(files.map((f) => f.name));
                }}
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-white/50">
              Style reference{" "}
              <span className="text-white/25">(до 5, только для ChatGPT)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/50 transition hover:border-white/15 hover:text-white/70">
              <ImageIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {styleRefPreviews.length > 0
                  ? `${styleRefPreviews.length} reference(s)`
                  : "Загрузить референс…"}
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
                }}
              />
            </label>
            {styleRefPreviews.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {styleRefPreviews.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`ref ${i + 1}`}
                    className="h-12 w-12 rounded-md border border-white/8 object-cover"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-white/50">
            Optional style notes{" "}
            <span className="text-white/25">(попадут в prompt pack)</span>
          </label>
          <textarea
            className="w-full resize-none rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-white/90 placeholder-white/20 outline-none focus:border-[#5b8def]/50 focus:ring-1 focus:ring-[#5b8def]/30"
            rows={2}
            placeholder="Дополнительные пожелания по стилю (необязательно)…"
            value={s.styleNotes}
            onChange={(e) => setS((p) => ({ ...p, styleNotes: e.target.value }))}
          />
        </div>
      </div>

      {/* ── 2. IMPORTED SLIDES ───────────────────────────────────────────── */}
      {s.importedSlides.length > 0 && (
        <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
            2. Imported slides — {s.importedSlides.length}
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {s.importedSlides.map((sl) => (
              <div
                key={sl.slideIndex}
                className="relative aspect-square overflow-hidden rounded-lg border border-white/8 bg-white/[0.03]"
              >
                <img
                  src={`/wb/proxy-image?url=${encodeURIComponent(sl.imageUrl)}`}
                  alt={`Slide ${sl.slideIndex}`}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white/70">
                  {sl.slideIndex}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 3. AI ANALYSIS ──────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
            3. AI analysis
          </p>
          <button
            type="button"
            onClick={runAnalyze}
            disabled={!canAnalyze}
            className="rounded-lg border border-[#5b8def]/30 bg-[#5b8def]/10 px-3 py-1.5 text-xs font-medium text-[#5b8def] transition hover:bg-[#5b8def]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isAnalyzing ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Анализирую…
              </span>
            ) : (
              "Analyze carousel"
            )}
          </button>
        </div>

        {s.analyses.length > 0 && (
          <div className="space-y-3">
            {s.analyses.map((a) => (
              <div
                key={a.slideIndex}
                className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">Slide {a.slideIndex}</span>
                  <Badge label={a.slideRole.toUpperCase()} color="blue" />
                  {a.hasFace && <Badge label="FACE" color="purple" />}
                  {a.hasScreenshot && <Badge label="SCREENSHOT" color="amber" />}
                  {a.hasText && <Badge label="TEXT" color="green" />}
                </div>
                {a.originalText && (
                  <div>
                    <p className="text-[11px] text-white/40">OCR text:</p>
                    <p className="mt-0.5 text-xs text-white/70">{a.originalText}</p>
                  </div>
                )}
                {a.visualDescription && (
                  <div>
                    <p className="text-[11px] text-white/40">Visual description:</p>
                    <p className="mt-0.5 text-xs text-white/70">{a.visualDescription}</p>
                  </div>
                )}
                {a.visualElements.length > 0 && (
                  <div>
                    <p className="text-[11px] text-white/40">Visual elements:</p>
                    <p className="mt-0.5 text-xs text-white/60">
                      {a.visualElements.join(", ")}
                    </p>
                  </div>
                )}
                {(a.mentionedPeople.length > 0 ||
                  a.mentionedBrands.length > 0 ||
                  a.mentionedTools.length > 0 ||
                  a.mentionedPlatforms.length > 0) && (
                  <div>
                    <p className="text-[11px] text-white/40">Mentions:</p>
                    <p className="mt-0.5 text-xs text-white/60">
                      {[
                        ...a.mentionedPeople,
                        ...a.mentionedBrands,
                        ...a.mentionedTools,
                        ...a.mentionedPlatforms,
                      ].join(", ")}
                    </p>
                  </div>
                )}
                {a.hasScreenshot && a.screenshotDescription && (
                  <div>
                    <p className="text-[11px] text-white/40">Screenshot:</p>
                    <p className="mt-0.5 text-xs text-white/60">{a.screenshotDescription}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 4. REWRITE ──────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30">4. Rewrite</p>
          <button
            type="button"
            onClick={runRewrite}
            disabled={!canRewrite}
            className="rounded-lg border border-[#c27aff]/30 bg-[#c27aff]/10 px-3 py-1.5 text-xs font-medium text-[#c27aff] transition hover:bg-[#c27aff]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isRewriting ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Переписываю…
              </span>
            ) : (
              "Rewrite carousel text"
            )}
          </button>
        </div>

        {s.analyses.some((a) => a.rewrittenText) && (
          <div className="space-y-3">
            {s.rewrittenCaption && (
              <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                <p className="text-[11px] text-white/40 mb-1">Rewritten caption:</p>
                <textarea
                  className="w-full resize-none rounded border-0 bg-transparent text-xs text-white/80 outline-none"
                  rows={2}
                  value={s.rewrittenCaption}
                  onChange={(e) => setS((p) => ({ ...p, rewrittenCaption: e.target.value }))}
                />
              </div>
            )}
            {s.analyses.map((a) =>
              a.rewrittenText ? (
                <div
                  key={a.slideIndex}
                  className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-1.5"
                >
                  <p className="text-[11px] text-white/40">
                    Slide {a.slideIndex} — rewritten text:
                  </p>
                  <textarea
                    className="w-full resize-none rounded-lg bg-transparent px-2 py-1 text-xs text-white/80 outline-none focus:ring-1 focus:ring-[#c27aff]/30"
                    rows={3}
                    value={a.rewrittenText}
                    onChange={(e) => {
                      const val = e.target.value;
                      setS((p) => ({
                        ...p,
                        analyses: p.analyses.map((x) =>
                          x.slideIndex === a.slideIndex ? { ...x, rewrittenText: val } : x
                        ),
                      }));
                    }}
                  />
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      {/* ── 5. GPT PROMPT PACK ──────────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
            5. GPT Prompt Pack
          </p>
          <button
            type="button"
            onClick={runBuildPrompt}
            disabled={!canBuildPrompt}
            className="rounded-lg border border-[#5b8def]/30 bg-[#5b8def]/10 px-3 py-1.5 text-xs font-medium text-[#5b8def] transition hover:bg-[#5b8def]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> Build GPT Prompt
            </span>
          </button>
        </div>

        {s.gptPrompt && (
          <div className="space-y-2">
            <textarea
              readOnly
              className="w-full resize-none rounded-xl border border-white/8 bg-black/30 px-3 py-3 font-mono text-xs text-white/70 outline-none"
              rows={14}
              value={s.gptPrompt}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copyPrompt}
                className="flex items-center gap-1.5 rounded-lg border border-[#5b8def]/30 bg-[#5b8def]/10 px-3 py-1.5 text-xs font-medium text-[#5b8def] transition hover:bg-[#5b8def]/20"
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
                {copied ? "Скопировано!" : "Copy GPT prompt"}
              </button>
              <button
                type="button"
                onClick={downloadPrompt}
                className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/50 transition hover:text-white/70"
              >
                <Download className="h-3.5 w-3.5" />
                Download .txt
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 6. FINAL CAROUSEL SLIDES ─────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
          6. Final Carousel Slides
          {expectedSlideCount > 0 && (
            <span className="ml-2 font-normal normal-case text-white/20">
              (нужно {expectedSlideCount} слайдов)
            </span>
          )}
        </p>

        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/50 transition hover:border-white/15 hover:text-white/70">
          <ImageIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {finalSlideNames.length > 0
              ? `${finalSlideNames.length} слайд(ов) загружено`
              : "Загрузить готовые слайды из ChatGPT…"}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="sr-only"
            onChange={(e) => {
              handleFinalSlidesChange(Array.from(e.target.files ?? []));
            }}
          />
        </label>

        {s.finalSlideCountError && (
          <p className="text-xs text-amber-400/90">{s.finalSlideCountError}</p>
        )}

        {finalSlidePreviews.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {finalSlidePreviews.map((src, i) => (
              <div
                key={i}
                className="relative aspect-square overflow-hidden rounded-lg border border-white/8 bg-white/[0.03]"
              >
                <img
                  src={src}
                  alt={`Final slide ${i + 1}`}
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white/70">
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 7. PUBLISH TO INSTAGRAM ──────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
          7. Publish to Instagram
        </p>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-white/50">Final caption</label>
          <textarea
            className="w-full resize-none rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-white/90 placeholder-white/20 outline-none focus:border-[#3ecf8e]/50 focus:ring-1 focus:ring-[#3ecf8e]/30"
            rows={3}
            placeholder="Подпись для публикации (заполнится после рерайта)…"
            value={s.finalCaption}
            onChange={(e) => setS((p) => ({ ...p, finalCaption: e.target.value }))}
          />
        </div>

        <button
          type="button"
          onClick={runPublish}
          disabled={!canPublish}
          className="w-full rounded-xl border border-[#3ecf8e]/25 bg-gradient-to-b from-[#0d2620]/80 to-[#091a15]/60 py-2.5 text-sm font-medium text-[#3ecf8e] transition hover:border-[#3ecf8e]/45 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPublishing ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Публикую…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Send className="h-4 w-4" /> Publish carousel
            </span>
          )}
        </button>

        {s.publishError && (
          <p className="text-xs text-amber-400/90">Publish failed: {s.publishError}</p>
        )}

        {s.publishResult && (
          <div className="rounded-lg border border-[#3ecf8e]/20 bg-[#3ecf8e]/5 p-3 space-y-1">
            <p className="text-xs font-medium text-[#3ecf8e]">Карусель опубликована!</p>
            {s.publishResult.publishId && (
              <p className="text-[11px] text-white/50">ID: {s.publishResult.publishId}</p>
            )}
            {s.publishResult.permalink && (
              <a
                href={s.publishResult.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[11px] text-[#5b8def] hover:underline"
              >
                Открыть публикацию ↗
              </a>
            )}
          </div>
        )}
      </div>

      {/* ── RESET ── */}
      {(s.status !== "idle" ||
        s.importedSlides.length > 0 ||
        s.analyses.length > 0 ||
        finalSlidePreviews.length > 0) ? (
        <button
          type="button"
          onClick={reset}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/8 py-2 text-xs text-white/30 transition hover:text-white/60"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      ) : null}
    </div>
  );
}
