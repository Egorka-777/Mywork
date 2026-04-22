import { useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  Hash,
  ImageIcon,
  Loader2,
  Send,
  Share2,
  Sparkles,
  XCircle,
} from "lucide-react";

type StepStatus = "idle" | "running" | "done" | "error" | "skipped";

interface PipelineState {
  sourceText: string;
  style: string;
  rewritten: string;
  imagePrompt: string;
  imageUrl: string | null;
  steps: Record<string, StepStatus>;
  errors: Record<string, string>;
}

const INITIAL: PipelineState = {
  sourceText: "",
  style: "",
  rewritten: "",
  imagePrompt: "",
  imageUrl: null,
  steps: { rewrite: "idle", image: "idle", publish: "idle" },
  errors: {},
};

function StepBadge({ status }: { status: StepStatus }) {
  if (status === "running")
    return <Loader2 className="h-4 w-4 animate-spin text-[#5b8def]" />;
  if (status === "done")
    return <CheckCircle className="h-4 w-4 text-[#3ecf8e]" />;
  if (status === "error")
    return <XCircle className="h-4 w-4 text-amber-400" />;
  return null;
}

export function FreedzPipeline() {
  const [s, setS] = useState<PipelineState>(INITIAL);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<string | null>(null);

  const setStep = (step: string, status: StepStatus, err?: string) =>
    setS((prev) => ({
      ...prev,
      steps: { ...prev.steps, [step]: status },
      errors: err
        ? { ...prev.errors, [step]: err }
        : { ...prev.errors, [step]: "" },
    }));

  const runRewrite = async () => {
    if (!s.sourceText.trim()) return;
    setS((prev) => ({ ...prev, rewritten: "", imageUrl: null }));
    setStep("rewrite", "running");
    try {
      const r = await fetch("/wb/pipeline/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: s.sourceText, style: s.style || undefined }),
      });
      const d = (await r.json()) as { ok?: boolean; rewritten?: string; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Ошибка рерайта");
      setS((prev) => ({
        ...prev,
        rewritten: d.rewritten ?? "",
        imagePrompt: d.rewritten?.slice(0, 200) ?? "",
        steps: { ...prev.steps, rewrite: "done" },
        errors: { ...prev.errors, rewrite: "" },
      }));
    } catch (e) {
      setStep("rewrite", "error", e instanceof Error ? e.message : String(e));
    }
  };

  const runImage = async () => {
    const prompt = s.imagePrompt.trim() || s.rewritten.trim();
    if (!prompt) return;
    setStep("image", "running");
    try {
      const r = await fetch("/wb/pipeline/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const d = (await r.json()) as { ok?: boolean; url?: string | null; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Ошибка генерации");
      setS((prev) => ({
        ...prev,
        imageUrl: d.url ?? null,
        steps: { ...prev.steps, image: "done" },
        errors: { ...prev.errors, image: "" },
      }));
    } catch (e) {
      setStep("image", "error", e instanceof Error ? e.message : String(e));
    }
  };

  const runPublish = async () => {
    const text = s.rewritten.trim() || s.sourceText.trim();
    if (!text) return;
    setPublishing(true);
    setStep("publish", "running");
    try {
      const r = await fetch("/wb/pipeline/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, imageUrl: s.imageUrl ?? undefined }),
      });
      const d = (await r.json()) as { ok?: boolean; threadId?: string; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Ошибка публикации");
      setPublished(d.threadId ?? "ok");
      setStep("publish", "done");
    } catch (e) {
      setStep("publish", "error", e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  };

  const reset = () => {
    setS(INITIAL);
    setPublished(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1.5 text-xs text-white/30">
        <Hash className="h-3 w-3" />
        <span>Источник</span>
        <ArrowRight className="h-3 w-3" />
        <Sparkles className="h-3 w-3" />
        <span>Gemini</span>
        <ArrowRight className="h-3 w-3" />
        <ImageIcon className="h-3 w-3" />
        <span>Fal.ai</span>
        <ArrowRight className="h-3 w-3" />
        <Share2 className="h-3 w-3" />
        <span>Threads</span>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-white/50">
          Исходный текст
        </label>
        <textarea
          className="w-full rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-white/90 placeholder-white/20 outline-none focus:border-[#5b8def]/50 focus:ring-1 focus:ring-[#5b8def]/30 resize-none"
          rows={4}
          placeholder="Вставьте пост из канала, ссылку, идею…"
          value={s.sourceText}
          onChange={(e) => setS((p) => ({ ...p, sourceText: e.target.value }))}
        />
        <input
          className="w-full rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-[#5b8def]/50 focus:ring-1 focus:ring-[#5b8def]/30"
          placeholder="Стиль (необязательно): дерзко, коротко, по-деловому…"
          value={s.style}
          onChange={(e) => setS((p) => ({ ...p, style: e.target.value }))}
        />
      </div>

      <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#5b8def]" />
            <span className="text-sm font-medium text-white">
              1. Рерайт через Gemini
            </span>
            <StepBadge status={s.steps.rewrite} />
          </div>
          <button
            onClick={runRewrite}
            disabled={!s.sourceText.trim() || s.steps.rewrite === "running"}
            className="rounded-lg border border-[#5b8def]/30 bg-[#5b8def]/10 px-3 py-1.5 text-xs font-medium text-[#5b8def] transition hover:bg-[#5b8def]/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {s.steps.rewrite === "running" ? "Генерирую…" : "Запустить"}
          </button>
        </div>
        {s.errors.rewrite && (
          <p className="text-xs text-amber-400/90">{s.errors.rewrite}</p>
        )}
        {s.rewritten && (
          <textarea
            className="w-full rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/80 outline-none focus:border-[#5b8def]/40 resize-none"
            rows={4}
            value={s.rewritten}
            onChange={(e) => setS((p) => ({ ...p, rewritten: e.target.value }))}
          />
        )}
      </div>

      <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-[#c27aff]" />
            <span className="text-sm font-medium text-white">
              2. Картинка — Fal.ai
            </span>
            <StepBadge status={s.steps.image} />
          </div>
          <button
            onClick={runImage}
            disabled={
              (!s.rewritten.trim() && !s.imagePrompt.trim()) ||
              s.steps.image === "running"
            }
            className="rounded-lg border border-[#c27aff]/30 bg-[#c27aff]/10 px-3 py-1.5 text-xs font-medium text-[#c27aff] transition hover:bg-[#c27aff]/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {s.steps.image === "running" ? "Генерирую…" : "Сгенерировать"}
          </button>
        </div>
        <input
          className="w-full rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/80 placeholder-white/20 outline-none focus:border-[#c27aff]/40"
          placeholder="Промпт для картинки (авто из текста)"
          value={s.imagePrompt}
          onChange={(e) => setS((p) => ({ ...p, imagePrompt: e.target.value }))}
        />
        {s.errors.image && (
          <p className="text-xs text-amber-400/90">{s.errors.image}</p>
        )}
        {s.imageUrl && (
          <img
            src={s.imageUrl}
            alt="Сгенерированная картинка"
            className="w-full rounded-xl border border-white/8 object-cover max-h-64"
          />
        )}
      </div>

      <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-white/40" />
            <span className="text-sm font-medium text-white">3. Threads</span>
            <StepBadge status={s.steps.publish} />
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300/80">
              токен завтра
            </span>
          </div>
          <button
            onClick={runPublish}
            disabled={
              publishing ||
              (!s.rewritten.trim() && !s.sourceText.trim()) ||
              s.steps.publish === "running"
            }
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {publishing ? "Публикую…" : "Опубликовать"}
          </button>
        </div>
        {s.errors.publish && (
          <p className="text-xs text-amber-400/90">{s.errors.publish}</p>
        )}
        {published && (
          <p className="text-xs text-[#3ecf8e]">
            Опубликовано ✓ ID: {published}
          </p>
        )}
      </div>

      {(s.steps.rewrite !== "idle" ||
        s.steps.image !== "idle" ||
        s.steps.publish !== "idle") && (
        <button
          onClick={reset}
          className="w-full rounded-xl border border-white/8 py-2 text-xs text-white/30 transition hover:text-white/60"
        >
          Сбросить пайплайн
        </button>
      )}

      <div className="pt-1 border-t border-white/5">
        <p className="text-[11px] text-white/25">
          Модель: {" "}
          <code className="font-mono text-white/35">
            gemini-2.0-flash-lite-001
          </code>{" "}
          · Генерация: nano-banana-pro/edit
        </p>
      </div>
    </div>
  );
}
