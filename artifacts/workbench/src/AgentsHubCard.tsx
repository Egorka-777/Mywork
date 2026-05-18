import type { BrainState } from "./brainTypes";

export type AgentsHubCardProps = {
  state: BrainState | null;
  agentsCount: number;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
};

export function AgentsHubCard({
  state,
  agentsCount,
  loading,
  error,
  onOpen,
}: AgentsHubCardProps) {
  const tasks = state?.dailyTasks ?? [];
  const doneTasks = tasks.filter((task) => task.status === "done").length;
  const focusWeekTitle = state?.focusWeek?.title ?? "Фокус недели не задан";

  return (
    <article className="card-glass relative overflow-hidden rounded-2xl p-5 md:col-span-2">
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-cyan-400/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-12 left-10 h-32 w-32 rounded-full bg-violet-500/20 blur-3xl"
        aria-hidden
      />

      <div className="relative flex h-full flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">
            Рабочая панель
          </p>

          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              Agents Hub
            </h2>
            <p className="max-w-2xl text-sm text-slate-300">
              Ежедневные задачи, агенты и мозг проекта
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-400">Фокус недели</p>
            <p className="mt-1 line-clamp-2 text-sm font-medium text-white">
              {loading ? "Загрузка сводки..." : focusWeekTitle}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-400">Задачи сегодня</p>
            <p className="mt-1 text-sm font-medium text-white">
              {tasks.length} всего · {doneTasks} готово
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-400">Агенты</p>
            <p className="mt-1 text-sm font-medium text-white">{agentsCount}</p>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-100">
            <p className="font-medium">Не удалось загрузить сводку</p>
            <p className="mt-1 text-red-100/80">{error}</p>
          </div>
        ) : null}

        {!loading && !error && !state ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-300">
            Сводка пока не загружена
          </div>
        ) : null}

        <div className="mt-auto flex justify-end">
          <button
            type="button"
            onClick={onOpen}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
          >
            Открыть рабочую панель
          </button>
        </div>
      </div>
    </article>
  );
}
