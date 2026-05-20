import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEntry, AgentWorkflow } from "./brainTypes";
import {
  createWorkflowPlan,
  fetchWorkflow,
  fetchWorkflows,
  startWorkflow,
} from "./brainApi";

const AGENT_COLORS: Record<string, { bubble: string; name: string; dot: string }> = {
  chief: { bubble: "bg-cyan-950/60 border-cyan-500/25", name: "text-cyan-300", dot: "bg-cyan-400" },
  marketer: { bubble: "bg-amber-950/60 border-amber-500/25", name: "text-amber-300", dot: "bg-amber-400" },
  content_maker: { bubble: "bg-emerald-950/60 border-emerald-500/25", name: "text-emerald-300", dot: "bg-emerald-400" },
  analyst: { bubble: "bg-violet-950/60 border-violet-500/25", name: "text-violet-300", dot: "bg-violet-400" },
  copywriter: { bubble: "bg-pink-950/60 border-pink-500/25", name: "text-pink-300", dot: "bg-pink-400" },
  system: { bubble: "bg-white/[0.04] border-white/10", name: "text-slate-400", dot: "bg-slate-400" },
};

const AGENT_LABELS: Record<string, string> = {
  chief: "Chief",
  marketer: "Marketer",
  content_maker: "Content Maker",
  analyst: "Analyst",
  copywriter: "Copywriter",
  system: "Система",
};

const PHASE_ICONS: Record<string, string> = {
  system: "▶",
  reading: "📖",
  thinking: "💭",
  output: "💬",
  sending: "→",
  review: "🔍",
  revision: "🔄",
  done: "✓",
  error: "✗",
};

function agentStyle(key: string) {
  return AGENT_COLORS[key] ?? AGENT_COLORS.system;
}

function agentLabel(key: string) {
  return AGENT_LABELS[key] ?? key;
}

function formatTime(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export type WorkflowLivePanelProps = {
  onClose: () => void;
};

export function WorkflowLivePanel({ onClose }: WorkflowLivePanelProps) {
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("");
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<AgentWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastWorkflows, setPastWorkflows] = useState<AgentWorkflow[]>([]);
  const [loadingPast, setLoadingPast] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeWorkflow?.activityLog?.length, activeWorkflow?.currentActivity]);

  useEffect(() => {
    setLoadingPast(true);
    fetchWorkflows(10)
      .then(setPastWorkflows)
      .catch(() => {})
      .finally(() => setLoadingPast(false));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback(
    (workflowId: string) => {
      stopPolling();
      pollingRef.current = setInterval(async () => {
        try {
          const wf = await fetchWorkflow(workflowId);
          setActiveWorkflow(wf);
          if (wf.status === "completed" || wf.status === "failed") {
            setRunning(false);
            stopPolling();
            fetchWorkflows(10).then(setPastWorkflows).catch(() => {});
          }
        } catch {
          // keep polling on transient errors
        }
      }, 1500);
    },
    [stopPolling]
  );

  async function handlePlan() {
    const t = title.trim();
    const r = request.trim();
    if (!t || !r) {
      setError("Укажи заголовок и запрос");
      return;
    }
    setError(null);
    setPlanning(true);
    setActiveWorkflow(null);
    try {
      const wf = await createWorkflowPlan({ title: t, userRequest: r });
      setActiveWorkflow(wf);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  }

  async function handleRun() {
    if (!activeWorkflow?.id) return;
    setError(null);
    setRunning(true);
    try {
      await startWorkflow(activeWorkflow.id);
      startPolling(activeWorkflow.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  }

  function handleStop() {
    stopPolling();
    setRunning(false);
  }

  function loadPastWorkflow(wf: AgentWorkflow) {
    stopPolling();
    setRunning(false);
    setActiveWorkflow(wf);
    setTitle(wf.title);
    setRequest(wf.userRequest);
    setError(null);
  }

  const isRunnable =
    !!activeWorkflow?.id &&
    (activeWorkflow.status === "planned" || activeWorkflow.status === "draft") &&
    !running;

  const activityLog: ActivityEntry[] = activeWorkflow?.activityLog ?? [];

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
    >
      <div className="mx-auto flex min-h-full max-w-6xl items-start justify-center py-4">
        <section className="card-glass flex w-full flex-col overflow-hidden rounded-3xl border border-white/10">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div>
              <h2 className="text-xl font-semibold text-white">
                Workflow — цепочка агентов
              </h2>
              <p className="mt-0.5 text-sm text-slate-400">
                Видишь каждое действие агентов в реальном времени
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              Закрыть
            </button>
          </header>

          <div className="grid gap-6 p-5 md:grid-cols-[minmax(280px,320px)_1fr]">
            <aside className="flex flex-col gap-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h3 className="mb-3 text-sm font-semibold text-white">Новая задача</h3>
                {error ? (
                  <div className="mb-3 rounded-xl border border-red-400/20 bg-red-500/10 p-2 text-xs text-red-200">
                    {error}
                  </div>
                ) : null}
                <label className="mb-2 flex flex-col gap-1 text-xs text-slate-400">
                  Заголовок
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={running || planning}
                    className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white disabled:opacity-50"
                    placeholder="Краткий заголовок…"
                  />
                </label>
                <label className="mb-3 flex flex-col gap-1 text-xs text-slate-400">
                  Запрос
                  <textarea
                    value={request}
                    onChange={(e) => setRequest(e.target.value)}
                    disabled={running || planning}
                    rows={4}
                    className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white disabled:opacity-50"
                    placeholder="Что нужно сделать команде агентов…"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handlePlan()}
                    disabled={planning || running}
                    className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
                  >
                    {planning ? "Разбираю…" : "Разобрать задачу"}
                  </button>
                  {running ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      className="rounded-full border border-red-400/40 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10"
                    >
                      Стоп
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleRun()}
                      disabled={!isRunnable}
                      className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                    >
                      Запустить ▶
                    </button>
                  )}
                </div>
              </div>

              {activeWorkflow?.ceoPlan ? (
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4">
                  <p className="mb-2 text-xs font-semibold text-cyan-300">📋 План Chief</p>
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-slate-200">
                    {activeWorkflow.ceoPlan}
                  </pre>
                </div>
              ) : null}

              {activeWorkflow && activeWorkflow.steps.length > 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="mb-2 text-xs font-semibold text-slate-400">
                    Шаги ({activeWorkflow.steps.length})
                  </p>
                  <ul className="space-y-1.5">
                    {activeWorkflow.steps.map((step, i) => {
                      const isActive = step.status === "running" || step.status === "reviewing";
                      const isDone = step.status === "completed";
                      const isFailed = step.status === "failed" || step.status === "revision_required";
                      const st = agentStyle(step.agentKey);
                      return (
                        <li key={step.id}>
                          <button
                            type="button"
                            onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                            className="w-full rounded-lg border border-white/10 bg-black/10 px-2 py-1.5 text-left transition hover:bg-white/5"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${
                                  isActive ? `${st.dot} animate-pulse` : isDone ? "bg-emerald-400" : isFailed ? "bg-red-400" : "bg-slate-600"
                                }`}
                              />
                              <span className={`text-xs font-semibold ${st.name}`}>
                                {agentLabel(step.agentKey)}
                              </span>
                              <span className="truncate text-xs text-slate-300">
                                {step.title}
                              </span>
                            </div>
                            {step.reviewerKey ? (
                              <p className="mt-0.5 pl-4 text-[10px] text-slate-500">
                                rev: {agentLabel(step.reviewerKey)}
                              </p>
                            ) : null}
                          </button>
                          {expandedStep === step.id && step.output ? (
                            <div className="mt-1 rounded-lg border border-white/10 bg-black/20 p-2">
                              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] text-slate-200">
                                {step.output}
                              </pre>
                              {step.reviewOutput ? (
                                <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] text-amber-200/80">
                                  {step.reviewOutput}
                                </pre>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {!loadingPast && pastWorkflows.length > 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="mb-2 text-xs font-semibold text-slate-400">
                    Прошлые задачи
                  </p>
                  <ul className="space-y-1">
                    {pastWorkflows.map((wf) => (
                      <li key={wf.id}>
                        <button
                          type="button"
                          onClick={() => loadPastWorkflow(wf)}
                          disabled={running}
                          className="w-full truncate rounded-lg border border-white/10 bg-black/10 px-2 py-1.5 text-left text-xs text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
                        >
                          <span
                            className={
                              wf.status === "completed" ? "text-emerald-400" : wf.status === "failed" ? "text-red-400" : wf.status === "running" ? "text-cyan-400" : "text-slate-500"
                            }
                          >
                            [{wf.status}]{" "}
                          </span>
                          {wf.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </aside>

            <div className="flex flex-col gap-4">
              <div className="flex min-h-[520px] flex-col rounded-2xl border border-white/10 bg-black/30">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                  <p className="text-sm font-semibold text-white">Живой чат агентов</p>
                  <div className="flex items-center gap-3">
                    {running ? (
                      <span className="flex items-center gap-1.5 text-xs text-cyan-300">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                        Работают…
                      </span>
                    ) : activityLog.length > 0 ? (
                      <span className="text-xs text-slate-500">{activityLog.length} действий</span>
                    ) : null}
                    {activeWorkflow?.status ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          activeWorkflow.status === "completed" ? "bg-emerald-500/20 text-emerald-300" : activeWorkflow.status === "failed" ? "bg-red-500/20 text-red-300" : activeWorkflow.status === "running" ? "bg-cyan-500/20 text-cyan-300" : "bg-white/10 text-slate-400"
                        }`}
                      >
                        {activeWorkflow.status}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                  {activityLog.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                      <p className="whitespace-pre-line text-center text-sm text-slate-500">
                        {planning ? "Chief разбирает задачу…" : running ? "Агенты запускаются…" : "Нажми «Разобрать задачу» → «Запустить ▶»\nчтобы увидеть живой поток агентов"}
                      </p>
                    </div>
                  ) : (
                    <>
                      {activityLog.map((entry) => <ActivityBubble key={entry.id} entry={entry} />)}
                      {running && activeWorkflow?.currentActivity ? <TypingIndicator text={activeWorkflow.currentActivity} /> : null}
                    </>
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>

              {activeWorkflow?.finalResult ? (
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/30 p-4">
                  <p className="mb-2 text-sm font-semibold text-emerald-300">✅ Финальный результат</p>
                  <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-white">{activeWorkflow.finalResult}</pre>
                </div>
              ) : null}

              {activeWorkflow?.status === "failed" && activeWorkflow.error ? (
                <div className="rounded-2xl border border-red-400/20 bg-red-950/30 p-4">
                  <p className="mb-1 text-sm font-semibold text-red-300">Ошибка</p>
                  <p className="text-sm text-red-200">{activeWorkflow.error}</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ActivityBubble({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const st = agentStyle(entry.agentKey);
  const icon = PHASE_ICONS[entry.phase] ?? "·";
  const label = agentLabel(entry.agentKey);
  const isSystem = entry.agentKey === "system";
  const isOutput = entry.phase === "output" || entry.phase === "review";
  const isLong = entry.text.length > 260;

  if (isSystem) {
    return (
      <div className="flex items-center justify-center gap-2 py-1">
        <span className="text-xs text-slate-500">{icon}</span>
        <span className="text-xs text-slate-500">{entry.text}</span>
        <span className="text-[10px] text-slate-700">{formatTime(entry.ts)}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${st.bubble}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sm leading-none">{icon}</span>
        <span className={`text-xs font-semibold ${st.name}`}>{label}</span>
        <span className="ml-auto text-[10px] text-slate-600">{formatTime(entry.ts)}</span>
      </div>

      {entry.text ? (
        <div>
          <pre
            className={`whitespace-pre-wrap text-xs leading-relaxed text-slate-200 ${!expanded && isLong ? "line-clamp-5" : ""} ${isOutput ? "text-slate-100" : "text-slate-400 italic"}`}
          >
            {entry.text}
          </pre>
          {isLong ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 text-[10px] text-cyan-400 hover:underline"
            >
              {expanded ? "Свернуть ▲" : "Развернуть ▼"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TypingIndicator({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
      <span className="flex gap-1">
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "150ms" }} />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "300ms" }} />
      </span>
      <span className="text-xs italic text-slate-500">{text}</span>
    </div>
  );
}
