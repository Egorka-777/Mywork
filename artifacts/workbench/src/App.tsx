import { useCallback, useEffect, useState } from "react";
import {
  Database,
  Image as ImageIcon,
  Link2,
  MessageSquare,
  Send,
  Sparkles,
} from "lucide-react";
import { FreedzPanel } from "./FreedzPanel";
import { TrackerTile } from "./TrackerTile";

type FreedzMeta = {
  automationEnabled: boolean;
  lastRun: string | null;
  lastError: string | null;
  notes?: string;
};

export default function App() {
  const [freedz, setFreedz] = useState<FreedzMeta | null>(null);
  const [freedzError, setFreedzError] = useState<string | null>(null);
  const [openFreedz, setOpenFreedz] = useState(false);

  const loadFreedz = useCallback(async () => {
    try {
      const r = await fetch("/api/freedz");
      if (!r.ok) {
        setFreedzError(`Freedz: ${r.status}`);
        return;
      }
      const j = (await r.json()) as FreedzMeta;
      setFreedz(j);
      setFreedzError(null);
    } catch (e) {
      setFreedzError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadFreedz();
  }, [loadFreedz]);

  return (
    <div className="min-h-svh">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(91, 141, 239, 0.15), transparent), radial-gradient(ellipse 50% 40% at 100% 0%, rgba(194, 122, 255, 0.1), transparent)",
        }}
      />
      <header className="border-b border-white/6 px-6 py-8 md:px-10">
        <p className="text-xs font-medium tracking-[0.2em] text-white/40 uppercase">
          Личный кабинет
        </p>
        <h1 className="mt-2 font-sans text-2xl font-semibold tracking-tight text-white md:text-3xl">
          Рабочее пространство
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[#6b6b7a]">
          Инструменты, которые вы добавляете — выключатели, пайплайны и
          визуальные схемы, без погрузки в код.
        </p>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[#6b6b7a]">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          <span>Карточки</span>
          <span className="text-white/20">·</span>
          <span>
            Telegram Tracker управляет существующим{" "}
            <code className="font-mono text-white/50">state.json</code>
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <TrackerTile />
          <FreedzCard
            onOpen={() => {
              setOpenFreedz(true);
              void loadFreedz();
            }}
            meta={freedz}
            error={freedzError}
            open={openFreedz}
          />
        </div>
      </main>

      {openFreedz && (
        <FreedzPanel
          onClose={() => setOpenFreedz(false)}
          onReload={loadFreedz}
        />
      )}
    </div>
  );
}

function FreedzCard({
  onOpen,
  meta,
  error,
  open,
}: {
  onOpen: () => void;
  meta: FreedzMeta | null;
  error: string | null;
  open: boolean;
}) {
  return (
    <div
      className={`card-glass group relative flex flex-col overflow-hidden rounded-2xl p-5 transition [box-shadow:0_0_0_1px_rgba(194,122,255,0.1)] ${
        open
          ? "ring-1 ring-[#c27aff]/30"
          : "hover:ring-1 hover:ring-[#c27aff]/20"
      }`}
    >
      <div
        className="absolute top-0 right-0 h-32 w-32 rounded-full opacity-20 blur-3xl"
        style={{ background: "#7c3aed" }}
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <h2 className="font-sans text-lg font-semibold text-white">
            Freedz — пост + картинка
          </h2>
          <p className="mt-1 text-sm text-[#6b6b7a]">
            Текст из источников → Gemini (стиль) → картинка (Fal.ai) →
            публикация во Freedz.
          </p>
        </div>
        <div className="hidden shrink-0 md:flex" aria-hidden>
          <div className="flex flex-col gap-0.5">
            <div className="h-1.5 w-1.5 rounded-full bg-white/20" />
            <div className="h-1.5 w-1.5 rounded-full bg-white/20" />
            <div className="h-1.5 w-1.5 rounded-full bg-white/20" />
          </div>
        </div>
      </div>
      {error && <p className="relative mt-3 text-sm text-amber-400/90">{error}</p>}
      {meta && !error && (
        <div className="relative mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={
              meta.automationEnabled
                ? "rounded-full border border-[#3ecf8e]/30 bg-[#3ecf8e]/10 px-2 py-0.5 text-[#3ecf8e]"
                : "rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white/50"
            }
          >
            {meta.automationEnabled ? "автозапуск в плане" : "только схема / черновик"}
          </span>
          {meta.lastRun && (
            <span className="text-white/30">
              посл. прогон: {meta.lastRun}
            </span>
          )}
        </div>
      )}
      <div className="relative mt-5 flex min-h-12 flex-1">
        <div className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2">
          <div className="flex flex-1 items-center gap-1.5 overflow-hidden text-white/30">
            <Link2 className="h-3.5 w-3.5 shrink-0" />
            <Database className="h-3.5 w-3.5 shrink-0" />
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
            <Send className="h-3.5 w-3.5 shrink-0" />
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="relative mt-4 w-full rounded-xl border border-[#c27aff]/25 bg-gradient-to-b from-[#2d1a45]/80 to-[#1a1028]/60 py-2.5 text-sm font-medium text-white transition hover:border-[#c27aff]/45 hover:from-[#3a2558]/80"
      >
        Открыть пайплайн
      </button>
    </div>
  );
}
