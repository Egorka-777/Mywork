import { Clapperboard, UserRound } from "lucide-react";

type LipsyncTileProps = {
  jobsCount: number;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
};

export function LipsyncTile({ jobsCount, loading, error, onOpen }: LipsyncTileProps) {
  return (
    <div className="card-glass group relative flex flex-col overflow-hidden rounded-2xl p-5 transition [box-shadow:0_0_0_1px_rgba(91,141,239,0.12)] hover:ring-1 hover:ring-blue-400/25">
      <div
        className="absolute top-0 right-0 h-32 w-32 rounded-full bg-blue-400 opacity-15 blur-3xl"
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <h2 className="font-sans text-lg font-semibold text-white">Lipsync Studio</h2>
          <p className="mt-1 text-sm text-[#6b6b7a]">
            Сценарий + выбранное лицо → job для Fal.ai / Creatify Aurora.
          </p>
        </div>
        <div className="rounded-xl border border-blue-400/20 bg-blue-400/10 p-2 text-blue-200">
          <Clapperboard className="h-4 w-4" aria-hidden />
        </div>
      </div>

      {error ? (
        <p className="relative mt-3 text-sm text-amber-300/90">{error}</p>
      ) : (
        <div className="relative mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-blue-400/25 bg-blue-400/10 px-2 py-0.5 text-blue-200">
            {loading ? "загрузка…" : `${jobsCount} jobs`}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white/50">
            Fal.ai ready
          </span>
        </div>
      )}

      <div className="relative mt-5 flex min-h-12 flex-1">
        <div className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2">
          <div className="flex flex-1 items-center gap-1.5 overflow-hidden text-white/30">
            <UserRound className="h-3.5 w-3.5 shrink-0" />
            <Clapperboard className="h-3.5 w-3.5 shrink-0" />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="relative mt-4 w-full rounded-xl border border-blue-400/25 bg-gradient-to-b from-blue-950/70 to-slate-950/70 py-2.5 text-sm font-medium text-white transition hover:border-blue-300/45"
      >
        Открыть студию
      </button>
    </div>
  );
}
