import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { FreedzPipeline } from "./FreedzPipeline";

type FreedzMeta = {
  automationEnabled: boolean;
  lastRun: string | null;
  lastError: string | null;
  notes?: string;
};

export function FreedzPanel({
  onClose,
  onReload,
}: {
  onClose: () => void;
  onReload: () => void | Promise<void>;
}) {
  const [data, setData] = useState<FreedzMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/freedz");
        if (!r.ok) {
          setError("Не удалось загрузить freedz-pipeline.json");
          return;
        }
        setData((await r.json()) as FreedzMeta);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Freedz — пайплайн"
    >
      <div className="card-glass flex max-h-[min(90vh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-white/8 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-3 md:px-5">
          <div>
            <h2 className="font-sans text-lg font-semibold text-white">
              Freedz — визуальный поток
            </h2>
            <p className="text-xs text-white/40">
              Не логи кода, а что откуда идёт. Настоящие API подключим отдельно.
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
          {error && (
            <p className="mb-4 text-sm text-amber-300/90">{error}</p>
          )}
          {data?.notes && (
            <p className="mb-4 rounded-lg border border-white/8 bg-white/[0.02] p-3 text-sm text-white/50">
              {data.notes}
            </p>
          )}
          <FreedzPipeline />
        </div>
        <div className="border-t border-white/6 px-4 py-3 text-center md:px-5">
          <button
            type="button"
            onClick={() => {
              void onReload();
            }}
            className="text-sm text-[#5b8def] hover:underline"
          >
            Обновить данные
          </button>
        </div>
      </div>
    </div>
  );
}
