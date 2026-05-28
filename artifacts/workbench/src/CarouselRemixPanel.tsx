import { ClipboardCopy, X } from "lucide-react";
import { CarouselRemixPipeline } from "./CarouselRemixPipeline";
import type { SourceRewriterNextActionPayload } from "./SourceRewriterPipeline";

type CarouselRemixPanelProps = {
  onClose: () => void;
  sourcePayload?: SourceRewriterNextActionPayload | null;
};

function copyText(text: string) {
  void navigator.clipboard.writeText(text);
}

export function CarouselRemixPanel({ onClose, sourcePayload }: CarouselRemixPanelProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Instagram Carousel Remix"
    >
      <div className="card-glass flex max-h-[min(92vh,940px)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-white/8 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-3 md:px-5">
          <div>
            <h2 className="font-sans text-lg font-semibold text-white">
              Instagram Carousel Remix
            </h2>
            <p className="text-xs text-white/40">
              Импорт → AI-анализ → рерайт → GPT Prompt Pack → публикация в Instagram.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/50 transition hover:bg-white/5 hover:text-white"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          {sourcePayload ? (
            <section className="mb-5 rounded-xl border border-[#14b8a6]/25 bg-[#14b8a6]/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#5eead4]">
                    Материал принят из Source Rewriter
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    Быстрый handoff: текст уже здесь. Скопируй его в caption/style ниже или используй как основу для ручной сборки карусели.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyText(sourcePayload.text || sourcePayload.markdown)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#14b8a6]/30 bg-[#14b8a6]/15 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#14b8a6]/25"
                >
                  <ClipboardCopy className="h-3.5 w-3.5" />
                  Скопировать текст
                </button>
              </div>
              <textarea
                readOnly
                className="mt-3 min-h-36 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-white/75 outline-none"
                value={sourcePayload.text || sourcePayload.markdown}
              />
            </section>
          ) : null}
          <CarouselRemixPipeline />
        </div>
      </div>
    </div>
  );
}
