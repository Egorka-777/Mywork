import { X } from "lucide-react";
import {
  SourceRewriterPipeline,
  type SourceRewriterNextActionPayload,
} from "./SourceRewriterPipeline";

type SourceRewriterPanelProps = {
  onClose: () => void;
  onNextAction?: (payload: SourceRewriterNextActionPayload) => void;
};

export function SourceRewriterPanel({ onClose, onNextAction }: SourceRewriterPanelProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Source Rewriter"
    >
      <div className="card-glass flex max-h-[min(92vh,940px)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-white/8 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-3 md:px-5">
          <div>
            <h2 className="font-sans text-lg font-semibold text-white">
              Рерайтер
            </h2>
            <p className="text-xs text-white/40">
              Извлечение текста, транскриптов и визуальных описаний с последующим
              переписыванием в моём стиле.
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
          <SourceRewriterPipeline onNextAction={onNextAction} />
        </div>
      </div>
    </div>
  );
}
