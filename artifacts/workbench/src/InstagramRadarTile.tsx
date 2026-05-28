import { Radar, Search } from "lucide-react";

type InstagramRadarTileProps = {
  postsCount: number;
  competitorsCount: number;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
};

export function InstagramRadarTile({
  postsCount,
  competitorsCount,
  loading,
  error,
  onOpen,
}: InstagramRadarTileProps) {
  return (
    <div className="card-glass group relative flex flex-col overflow-hidden rounded-2xl p-5 transition [box-shadow:0_0_0_1px_rgba(34,211,238,0.1)] hover:ring-1 hover:ring-cyan-400/25">
      <div
        className="absolute top-0 right-0 h-32 w-32 rounded-full bg-cyan-400 opacity-15 blur-3xl"
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <h2 className="font-sans text-lg font-semibold text-white">
            Instagram Radar
          </h2>
          <p className="mt-1 text-sm text-[#6b6b7a]">
            Свежие посты конкурентов за 1–3 дня.
          </p>
        </div>
        <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-2 text-cyan-200">
          <Radar className="h-4 w-4" aria-hidden />
        </div>
      </div>

      {error ? (
        <p className="relative mt-3 text-sm text-amber-300/90">{error}</p>
      ) : (
        <div className="relative mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-cyan-200">
            {competitorsCount} конкурентов
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white/50">
            {loading ? "загрузка…" : `${postsCount} постов в кэше`}
          </span>
        </div>
      )}

      <div className="relative mt-5 flex min-h-12 flex-1">
        <div className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2">
          <div className="flex flex-1 items-center gap-1.5 overflow-hidden text-white/30">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <Radar className="h-3.5 w-3.5 shrink-0" />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="relative mt-4 w-full rounded-xl border border-cyan-400/25 bg-gradient-to-b from-cyan-950/70 to-slate-950/70 py-2.5 text-sm font-medium text-white transition hover:border-cyan-300/45"
      >
        Открыть радар
      </button>
    </div>
  );
}
