import { useState } from "react";
import { ClipboardCopy, Loader2, ScanLine } from "lucide-react";
import { analyzeSourceVideoSkeleton } from "./lipsyncApi";

type VideoSkeletonAnalyzerProps = {
  script: string;
};

export function VideoSkeletonAnalyzer({ script }: VideoSkeletonAnalyzerProps) {
  const [video, setVideo] = useState<File | null>(null);
  const [skeleton, setSkeleton] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [frameCount, setFrameCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    if (!video) return;
    setLoading(true);
    setError(null);
    setSkeleton("");
    setWarnings([]);
    try {
      const result = await analyzeSourceVideoSkeleton(video, script);
      setSkeleton(result.skeleton);
      setWarnings(result.warnings);
      setFrameCount(result.frameCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mb-4 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
      <div className="flex items-start gap-3">
        <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
        <div>
          <h3 className="text-sm font-semibold text-white">Скелет исходного видео</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/45">
            Необязательно. Загрузи исходный ролик: система возьмёт до 6 опорных кадров и вернёт хук, сцены, монтажный ритм и инструкцию для пересборки.
          </p>
        </div>
      </div>

      <input
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        onChange={(event) => setVideo(event.target.files?.[0] ?? null)}
        className="mt-3 block w-full text-xs text-white/60"
      />

      <button
        type="button"
        onClick={() => void handleAnalyze()}
        disabled={!video || loading}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
        {loading ? "Анализирую ролик…" : "Разобрать видео"}
      </button>

      {error ? (
        <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100">
          {error}
        </div>
      ) : null}

      {skeleton ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-white/70">Разбор готов · {frameCount ?? 0} опорных кадров</p>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(skeleton)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/70 transition hover:text-white"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              Скопировать скелет
            </button>
          </div>
          {warnings.length ? <p className="mt-2 text-xs text-amber-200/80">{warnings.join(" ")}</p> : null}
          <textarea
            readOnly
            value={skeleton}
            className="mt-3 min-h-64 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-white/75 outline-none"
          />
        </div>
      ) : null}
    </section>
  );
}
