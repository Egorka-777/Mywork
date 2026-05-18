import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentWorkflow } from "./brainTypes";
import { createWorkflowPlan, fetchWorkflows } from "./brainApi";

type LiveEventType =
  | "workflow_started"
  | "step_started"
  | "step_thinking"
  | "step_output"
  | "review_started"
  | "review_output"
  | "revision_started"
  | "revision_output"
  | "step_completed"
  | "step_failed"
  | "workflow_completed"
  | "workflow_failed";

type LiveEvent = {
  type: LiveEventType;
  ts: string;
  agentKey: string;
  stepTitle?: string;
  stepIndex?: number;
  totalSteps?: number;
  text?: string;
  reviewStatus?: string;
  workflowStatus?: string;
  finalResult?: string;
  error?: string;
};

type LogEntry = LiveEvent & { id: string };

const AGENT_COLORS: Record<string, string> = {
  ceo: "text-cyan-300",
  operations: "text-violet-300",
  funnel: "text-amber-300",
  content_strategy: "text-emerald-300",
  rewriter: "text-pink-300",
  tech_architect: "text-sky-300",
};

const AGENT_LABELS: Record<string, string> = {
  ceo: "CEO",
  operations: "Operations",
  funnel: "Funnel",
  content_strategy: "Content",
  rewriter: "Rewriter",
  tech_architect: "Tech Arch",
};

const EVENT_ICONS: Record<LiveEventType, string> = {
  workflow_started: "▶",
  step_started: "→",
  step_thinking: "…",
  step_output: "💬",
  review_started: "🔍",
  review_output: "📋",
  revision_started: "🔄",
  revision_output: "✏️",
  step_completed: "✓",
  step_failed: "✗",
  workflow_completed: "✅",
  workflow_failed: "❌",
};

function agentColor(key: string) {
  return AGENT_COLORS[key] ?? "text-slate-300";
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
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pastWorkflows, setPastWorkflows] = useState<AgentWorkflow[]>([]);
  const [loadingPast, setLoadingPast] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const sseRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const idxRef = useRef(0);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    setLoadingPast(true);
    fetchWorkflows(10)
      .then(setPastWorkflows)
      .catch(() => {})
      .finally(() => setLoadingPast(false));
  }, []);

  const stopSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  useEffect(() => () => stopSSE(), [stopSSE]);

  function addLog(event: LiveEvent) {
    idxRef.current += 1;
    setLog((prev) => [...prev, { ...event, id: `${Date.now()}-${idxRef.current}` }]);
  }

  async function handlePlan() {
    const t = title.trim();
    const r = request.trim();
    if (!t || !r) {
      setError("Укажи заголовок и запрос");
      return;
    }
    setError(null);
    setPlanning(true);
    setLog([]);
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

  function handleRun() {
    if (!activeWorkflow?.id) return;
    stopSSE();
    setLog([]);
    setRunning(true);
    setError(null);

    const es = new EventSource(`/wb/workflows/${encodeURIComponent(activeWorkflow.id)}/stream`);
    sseRef.current = es;

    es.addEventListener("live", (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data as string) as LiveEvent;
        addLog(event);

        if (
          event.type === "workflow_completed" ||
          event.type === "workflow_failed"
        ) {
          setRunning(false);
          stopSSE();
          fetchWorkflows(10).then(setPastWorkflows).catch(() => {});
        }
      } catch {
        // ignore parse errors
      }
    });

    es.addEventListener("done", () => {
      setRunning(false);
      stopSSE();
    });

    es.onerror = () => {
      setError("Соединение прервано");
      setRunning(false);
      stopSSE();
    };
  }

  function handleStop() {
    stopSSE();
    setRunning(false);
  }

  function loadPastWorkflow(wf: AgentWorkflow) {
    setActiveWorkflow(wf);
    setTitle(wf.title);
    setRequest(wf.userRequest);
    setLog([]);
    setError(null);
  }

  const isRunnable =
    !!activeWorkflow?.id && activeWorkflow.status === "planned" && !running;

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
                Workflow Live — цепочка агентов
              </h2>
              <p className="mt-0.5 text-sm text-slate-400">
                Все агенты работают в реальном времени — видишь каждое сообщение
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

          <div className="grid gap-6 p-5 md:grid-cols-[minmax(280px,340px)_1fr]">
            <aside className="flex flex-col gap-5">
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
                    disabled={running}
                    className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white disabled:opacity-50"
                    placeholder="Краткий заголовок…"
                  />
                </label>
                <label className="mb-3 flex flex-col gap-1 text-xs text-slate-400">
                  Запрос
                  <textarea
                    value={request}
                    onChange={(e) => setRequest(e.target.value)}
                    disabled={running}
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
                      onClick={handleRun}
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
                  <p className="mb-2 text-xs font-semibold text-cyan-300">План CEO</p>
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
                      const statusColor =
                        step.status === "completed"
                          ? "text-emerald-400"
                          : step.status === "running" || step.status === "reviewing"
                          ? "text-cyan-300 animate-pulse"
                          : step.status === "failed" || step.status === "revision_required"
                          ? "text-red-400"
                          : "text-slate-500";
                      return (
                        <li key={step.id}>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedStep(expandedStep === step.id ? null : step.id)
                            }
                            className="w-full rounded-lg border border-white/10 bg-black/10 px-2 py-1.5 text-left transition hover:bg-white/5"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-mono ${statusColor}`}>
                                [{i + 1}]
                              </span>
                              <span className={`text-xs font-medium ${agentColor(step.agentKey)}`}>
                                {agentLabel(step.agentKey)}
                              </span>
                              <span className="truncate text-xs text-slate-300">
                                {step.title}
                              </span>
                            </div>
                            {step.reviewerKey ? (
                              <p className="mt-0.5 text-[10px] text-slate-500">
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
                              wf.status === "completed"
                                ? "text-emerald-400"
                                : wf.status === "failed"
                                ? "text-red-400"
                                : "text-slate-500"
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
              <div className="flex min-h-[480px] flex-col rounded-2xl border border-white/10 bg-black/30">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                  <p className="text-sm font-semibold text-white">
                    Live лог агентов
                  </p>
                  {running ? (
                    <span className="flex items-center gap-1.5 text-xs text-cyan-300">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                      Работают…
                    </span>
                  ) : log.length > 0 ? (
                    <span className="text-xs text-slate-500">{log.length} событий</span>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-2">
                  {log.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      {running
                        ? "Агенты запускаются…"
                        : "Нажми «Разобрать задачу» → «Запустить ▶» чтобы увидеть живой поток"}
                    </p>
                  ) : (
                    log.map((entry) => (
                      <LogEntryRow key={entry.id} entry={entry} />
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>

              {activeWorkflow?.finalResult ? (
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/30 p-4">
                  <p className="mb-2 text-sm font-semibold text-emerald-300">
                    Финальный результат
                  </p>
                  <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-white">
                    {activeWorkflow.finalResult}
                  </pre>
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

function LogEntryRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const icon = EVENT_ICONS[entry.type] ?? "·";
  const color = agentColor(entry.agentKey);
  const label = agentLabel(entry.agentKey);
  const hasText = !!entry.text && entry.text.length > 0;
  const isLong = hasText && entry.text!.length > 200;

  const bgClass =
    entry.type === "workflow_completed"
      ? "border-emerald-500/20 bg-emerald-950/20"
      : entry.type === "workflow_failed" || entry.type === "step_failed"
      ? "border-red-400/20 bg-red-950/20"
      : entry.type === "review_output"
      ? "border-amber-400/15 bg-amber-950/10"
      : entry.type === "step_output" || entry.type === "revision_output"
      ? "border-white/10 bg-white/[0.04]"
      : "border-transparent bg-transparent";

  return (
    <div className={`rounded-xl border px-3 py-2 ${bgClass}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-base leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold ${color}`}>{label}</span>
            {entry.stepTitle ? (
              <span className="text-xs text-slate-400">· {entry.stepTitle}</span>
            ) : null}
            {entry.reviewStatus ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  entry.reviewStatus === "passed"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : entry.reviewStatus === "failed"
                    ? "bg-red-500/20 text-red-300"
                    : "bg-slate-500/20 text-slate-400"
                }`}
              >
                {entry.reviewStatus}
              </span>
            ) : null}
            <span className="ml-auto text-[10px] text-slate-600">
              {formatTime(entry.ts)}
            </span>
          </div>

          {hasText ? (
            <div className="mt-1">
              <pre
                className={`whitespace-pre-wrap text-xs text-slate-200 ${
                  !expanded && isLong ? "line-clamp-4" : ""
                }`}
              >
                {entry.text}
              </pre>
              {isLong ? (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 text-[10px] text-cyan-400 hover:underline"
                >
                  {expanded ? "Свернуть" : "Развернуть"}
                </button>
              ) : null}
            </div>
          ) : null}

          {entry.error ? (
            <p className="mt-1 text-xs text-red-300">{entry.error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
