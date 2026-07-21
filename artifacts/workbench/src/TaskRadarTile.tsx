import { Zap } from "lucide-react";

type TaskRadarTileProps = {
  newCount: number;
  lastRunAt: string | null;
  telegramOk: boolean | null;
  webOk: boolean | null;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
};

function formatAgo(iso: string | null): string {
  if (!iso) return "ещё не искали";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "ещё не искали";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
}

export function TaskRadarTile({
  newCount,
  lastRunAt,
  telegramOk,
  webOk,
  loading,
  error,
  onOpen,
}: TaskRadarTileProps) {
  return (
    <div className="card-glass group relative flex flex-col overflow-hidden rounded-2xl p-5 transition [box-shadow:0_0_0_1px_rgba(250,204,21,0.12)] hover:ring-1 hover:ring-amber-300/25">
      <div
        className="absolute top-0 right-0 h-32 w-32 rounded-full bg-amber-400 opacity-15 blur-3xl"
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <h2 className="font-sans text-lg font-semibold text-white">⚡ Радар задач</h2>
          <p className="mt-1 text-sm text-[#6b6b7a]">
            Свежие запросы из Telegram и интернета
          </p>
        </div>
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-2 text-amber-100">
          <Zap className="h-4 w-4" aria-hidden />
        </div>
      </div>

      {error ? (
        <p className="relative mt-3 text-sm text-amber-300/90">{error}</p>
      ) : (
        <div className="relative mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-amber-100">
            {loading ? "…" : `${newCount} новых`}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white/50">
            {formatAgo(lastRunAt)}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 ${
              telegramOk
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                : "border-white/10 bg-white/5 text-white/40"
            }`}
          >
            TG {telegramOk ? "OK" : "—"}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 ${
              webOk
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                : "border-white/10 bg-white/5 text-white/40"
            }`}
          >
            Web {webOk ? "OK" : "—"}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={onOpen}
        className="relative mt-5 w-full rounded-xl border border-amber-400/25 bg-gradient-to-b from-amber-950/70 to-slate-950/70 py-2.5 text-sm font-medium text-white transition hover:border-amber-300/45"
      >
        Открыть радар
      </button>
    </div>
  );
}
