import { useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  ImageIcon,
  Link2,
  Loader2,
  RotateCcw,
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
  | "generating"
  | "done"
  | "error";

const INITIAL_STATE = {
  instagramUrl: "",
  caption: "",
  style: "",
  importedSlides: [] as ImportedSlide[],
  importError: null as string | null,
  analyses: [] as SlideAnalysis[],
  rewrittenCaption: "",
  generatedSlides: [] as { slideIndex: number; generatedImageUrl: string | null; error: string | null }[],
  status: "idle" as PipelineStatus,
  statusMessage: "",
};

function Badge({ label, color }: { label: string; color: string }) {
  const styles: Record<string, string> = {
    blue: "border-[#5b8def]/30 bg-[#5b8def]/10 text-[#5b8def]",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    purple: "border-[#c27aff]/30 bg-[#c27aff]/10 text-[#c27aff]",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[color] ?? styles.blue}`}>
      {label}
    </span>
  );
}

function StatusIcon({ status }: { status: PipelineStatus | "running" | "done" | "error" }) {
  if (status === "running" || status === "importing" || status === "analyzing" || status === "rewriting" || status === "generating")
    return <Loader2 className="h-4 w-4 animate-spin text-[#5b8def]" />;
  if (status === "done") return <CheckCircle className="h-4 w-4 text-[#3ecf8e]" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-amber-400" />;
  return null;
}

export function CarouselRemixPipeline() {
  const [s, setS] = useState(INITIAL_STATE);
  const manualFilesRef = useRef<File[]>([]);
  const userPhotoRef = useRef<File | null>(null);
  const [manualFileNames, setManualFileNames] = useState<string[]>([]);
  const [userPhotoName, setUserPhotoName] = useState<string>("");

  const setStatus = (status: PipelineStatus, msg = "") =>
    setS((p) => ({ ...p, status, statusMessage: msg }));

  const runImport = async () => {
    if (!s.instagramUrl.trim()) return;
    setS((p) => ({ ...p, status: "importing", statusMessage: "Импортирую через Apify…", importError: null, importedSlides: [] }));
    try {
      const r = await fetch("/wb/carousel/import-instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: s.instagramUrl.trim() }),
      });
      const d = await r.json() as {
        ok?: boolean;
        caption?: string;
        slides?: ImportedSlide[];
        error?: string;
        detail?: string;
      };
      if (!r.ok || !d.ok) throw new Error(d.error ? `${d.error}${d.detail ? ` — ${d.detail}` : ""}` : "Import failed");
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
      const d = await r.json() as {
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

  const runRewrite = async () => {
    if (s.analyses.length === 0) return;
    setStatus("rewriting", "Переписываю текст…");
    try {
      const r = await fetch("/wb/carousel/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: s.caption, style: s.style, slides: s.analyses }),
      });
      const d = await r.json() as {
        ok?: boolean;
        slides?: { slideIndex: number; rewrittenText: string; generationPrompt: string }[];
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
      }));
    } catch (e) {
      setStatus("error", e instanceof Error ? e.message : String(e));
    }
  };

  const runGenerate = async () => {
    const hasRewritten = s.analyses.some((a) => a.rewrittenText.trim());
    if (!hasRewritten) return;
    setStatus("generating", "Генерирую изображения…");
    try {
      const fd = new FormData();
      fd.append("slidesJson", JSON.stringify(s.analyses));
      if (userPhotoRef.current) fd.append("userPhoto", userPhotoRef.current);
      if (s.importedSlides.length === 0 && manualFilesRef.current.length > 0) {
        for (const f of manualFilesRef.current) fd.append("slideFiles", f);
      }
      const r = await fetch("/wb/carousel/generate", { method: "POST", body: fd });
      const d = await r.json() as {
        ok?: boolean;
        slides?: { slideIndex: number; generatedImageUrl: string | null; error: string | null }[];
        error?: string;
      };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Generation failed");

      const updatedAnalyses = s.analyses.map((a) => {
        const match = (d.slides ?? []).find((sl) => sl.slideIndex === a.slideIndex);
        return match ? { ...a, generatedImageUrl: match.generatedImageUrl, error: match.error } : a;
      });
      setS((p) => ({ ...p, status: "done", statusMessage: "Карусель готова!", analyses: updatedAnalyses }));
    } catch (e) {
      setStatus("error", e instanceof Error ? e.message : String(e));
    }
  };

  const reset = () => {
    setS(INITIAL_STATE);
    manualFilesRef.current = [];
    userPhotoRef.current = null;
    setManualFileNames([]);
    setUserPhotoName("");
  };

  const isImporting = s.status === "importing";
  const isAnalyzing = s.status === "analyzing";
  const isRewriting = s.status === "rewriting";
  const isGenerating = s.status === "generating";
  const isBusy = isImporting || isAnalyzing || isRewriting || isGenerating;

  const canAnalyze = (s.importedSlides.length > 0 || manualFilesRef.current.length > 0) && !isBusy;
  const canRewrite = s.analyses.length > 0 && !isBusy;
  const canGenerate = s.analyses.some((a) => a.rewrittenText.trim()) && !isBusy;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-xs text-white/30">
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
        <ImageIcon className="h-3 w-3" />
        <span>Генерация</span>
      </div>

      {s.statusMessage && (
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
          s.status === "error"
            ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
            : "border-[#5b8def]/20 bg-[#5b8def]/5 text-[#5b8def]"
        }`}>
          <StatusIcon status={s.status} />
          <span>{s.statusMessage}</span>
        </div>
      )}

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
              className="rounded-xl border border-[#5b8def]/30 bg-[#5b8def]/10 px-4 py-2 text-sm font-medium text-[#5b8def] transition hover:bg-[#5b8def]/20 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
            >
              {isImporting ? (
                <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Импорт…</span>
              ) : "Import from Instagram"}
            </button>
          </div>
          {s.importError && (
            <p className="text-xs text-amber-400/90">Import failed: {s.importError}. Upload slide images manually.</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-white/50">Caption</label>
          <textarea
            className="w-full rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-white/90 placeholder-white/20 outline-none focus:border-[#5b8def]/50 focus:ring-1 focus:ring-[#5b8def]/30 resize-none"
            rows={3}
            placeholder="Подпись к посту (заполнится автоматически при импорте)…"
            value={s.caption}
            onChange={(e) => setS((p) => ({ ...p, caption: e.target.value }))}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-white/50">Style</label>
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
              <span className="truncate">{manualFileNames.length > 0 ? `${manualFileNames.length} файл(ов)` : "Выбрать изображения…"}</span>
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
            <label className="block text-xs font-medium text-white/50">User photo (для замены лиц)</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/50 transition hover:border-white/15 hover:text-white/70">
              <ImageIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{userPhotoName || "Выбрать фото…"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  userPhotoRef.current = f;
                  setUserPhotoName(f?.name ?? "");
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {s.importedSlides.length > 0 && (
        <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
            2. Imported slides — {s.importedSlides.length}
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {s.importedSlides.map((sl) => (
              <div key={sl.slideIndex} className="relative aspect-square overflow-hidden rounded-lg border border-white/8 bg-white/[0.03]">
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

      <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30">3. AI analysis</p>
          <button
            type="button"
            onClick={runAnalyze}
            disabled={!canAnalyze}
            className="rounded-lg border border-[#5b8def]/30 bg-[#5b8def]/10 px-3 py-1.5 text-xs font-medium text-[#5b8def] transition hover:bg-[#5b8def]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isAnalyzing ? (
              <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Анализирую…</span>
            ) : "Analyze carousel"}
          </button>
        </div>

        {s.analyses.length > 0 && (
          <div className="space-y-3">
            {s.analyses.map((a) => (
              <div key={a.slideIndex} className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">Slide {a.slideIndex}</span>
                  {a.hasFace && <Badge label="FACE" color="blue" />}
                  {a.hasScreenshot && <Badge label="SCREENSHOT_LOCKED" color="amber" />}
                  {a.hasText && <Badge label="TEXT" color="purple" />}
                </div>
                {a.originalText && (
                  <div>
                    <p className="text-[11px] text-white/40">Original OCR text:</p>
                    <p className="mt-0.5 text-xs text-white/70">{a.originalText}</p>
                  </div>
                )}
                {a.visualDescription && (
                  <div>
                    <p className="text-[11px] text-white/40">Visual description:</p>
                    <p className="mt-0.5 text-xs text-white/70">{a.visualDescription}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
              <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Переписываю…</span>
            ) : "Rewrite carousel text"}
          </button>
        </div>

        {s.analyses.some((a) => a.rewrittenText) && (
          <div className="space-y-3">
            {s.rewrittenCaption && (
              <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                <p className="text-[11px] text-white/40 mb-1">Rewritten caption:</p>
                <textarea
                  className="w-full rounded border-0 bg-transparent text-xs text-white/80 outline-none resize-none"
                  rows={2}
                  value={s.rewrittenCaption}
                  onChange={(e) => setS((p) => ({ ...p, rewrittenCaption: e.target.value }))}
                />
              </div>
            )}
            {s.analyses.map((a) =>
              a.rewrittenText ? (
                <div key={a.slideIndex} className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-1.5">
                  <p className="text-[11px] text-white/40">Slide {a.slideIndex} — rewritten text:</p>
                  <textarea
                    className="w-full rounded border-0 bg-transparent text-xs text-white/80 outline-none resize-none focus:ring-1 focus:ring-[#c27aff]/30 rounded-lg px-2 py-1"
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

      <div className="space-y-3 rounded-xl border border-white/6 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30">5. Generate</p>
          <button
            type="button"
            onClick={runGenerate}
            disabled={!canGenerate}
            className="rounded-lg border border-[#3ecf8e]/30 bg-[#3ecf8e]/10 px-3 py-1.5 text-xs font-medium text-[#3ecf8e] transition hover:bg-[#3ecf8e]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isGenerating ? (
              <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Генерирую…</span>
            ) : "Generate carousel images"}
          </button>
        </div>

        {s.analyses.some((a) => a.generatedImageUrl || a.error) && (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {s.analyses.map((a) =>
              a.generatedImageUrl || a.error ? (
                <div key={a.slideIndex} className="space-y-1.5">
                  <p className="text-[11px] text-white/40">Slide {a.slideIndex}</p>
                  {a.generatedImageUrl ? (
                    <>
                      <img
                        src={a.generatedImageUrl}
                        alt={`Generated slide ${a.slideIndex}`}
                        className="w-full rounded-lg border border-white/8 object-cover"
                      />
                      <a
                        href={a.generatedImageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-center text-[11px] text-[#5b8def] hover:underline"
                      >
                        open image ↗
                      </a>
                    </>
                  ) : (
                    <p className="text-xs text-amber-400/90">{a.error}</p>
                  )}
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      {s.status !== "idle" || s.importedSlides.length > 0 || s.analyses.length > 0 ? (
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
