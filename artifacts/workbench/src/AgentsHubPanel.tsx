import { useEffect, useMemo, useState } from "react";
import {
  fetchAgentMessages,
  fetchAgents,
  fetchBrainState,
  saveBrainLogEntry,
  sendAgentMessage,
} from "./brainApi";
import type {
  AgentSummary,
  BrainLogEntryType,
  BrainMessage,
  BrainState,
} from "./brainTypes";

export type AgentsHubPanelProps = {
  onClose: () => void;
  onStateUpdated?: (state: BrainState) => void;
};

export function AgentsHubPanel({
  onClose,
  onStateUpdated,
}: AgentsHubPanelProps) {
  const [state, setState] = useState<BrainState | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentKey, setSelectedAgentKey] = useState("");
  const [messages, setMessages] = useState<BrainMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingLog, setSavingLog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [logMessage, setLogMessage] = useState<BrainMessage | null>(null);
  const [logEntryType, setLogEntryType] = useState<BrainLogEntryType>("insight");
  const [logTitle, setLogTitle] = useState("");
  const [logBody, setLogBody] = useState("");
  const [logTags, setLogTags] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      setLoadingInitial(true);
      setError(null);

      try {
        const [nextState, nextAgents] = await Promise.all([
          fetchBrainState(),
          fetchAgents(),
        ]);

        if (cancelled) return;

        setState(nextState);
        setAgents(nextAgents);
        onStateUpdated?.(nextState);

        if (nextAgents.length > 0) {
          setSelectedAgentKey((current) => current || nextAgents[0].key);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setLoadingInitial(false);
        }
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [onStateUpdated]);

  useEffect(() => {
    if (!selectedAgentKey) return;

    let cancelled = false;

    async function loadMessages() {
      setLoadingMessages(true);
      setError(null);

      try {
        const nextMessages = await fetchAgentMessages(selectedAgentKey);
        if (!cancelled) {
          setMessages(nextMessages);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setLoadingMessages(false);
        }
      }
    }

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [selectedAgentKey]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.key === selectedAgentKey) ?? null,
    [agents, selectedAgentKey]
  );

  const tasks = state?.dailyTasks ?? [];
  const doneTasks = tasks.filter((task) => task.status === "done").length;

  async function handleSendMessage() {
    const content = messageInput.trim();
    if (!selectedAgentKey || !content) return;

    setSending(true);
    setError(null);

    try {
      await sendAgentMessage(selectedAgentKey, content);
      setMessageInput("");
      const updatedMessages = await fetchAgentMessages(selectedAgentKey);
      setMessages(updatedMessages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  function openLogForm(message: BrainMessage) {
    setLogMessage(message);
    setLogEntryType("insight");
    setLogTitle(
      selectedAgent?.name ? `Ответ ${selectedAgent.name}` : "Ответ агента"
    );
    setLogBody(message.content);
    setLogTags(selectedAgentKey);
  }

  function closeLogForm() {
    setLogMessage(null);
    setLogTitle("");
    setLogBody("");
    setLogTags("");
  }

  async function handleSaveLog() {
    if (!logMessage || !selectedAgentKey) return;

    const title = logTitle.trim();
    const body = logBody.trim();

    if (!title || !body) {
      setError("Заполни title и body для записи в мозг");
      return;
    }

    const tags = logTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    setSavingLog(true);
    setError(null);

    try {
      await saveBrainLogEntry({
        agentKey: selectedAgentKey,
        entryType: logEntryType,
        title,
        body,
        tags,
      });
      closeLogForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLog(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Agents Hub"
    >
      <div className="mx-auto flex min-h-full max-w-7xl items-center justify-center">
        <section className="card-glass flex max-h-[min(92vh,940px)] w-full flex-col overflow-hidden rounded-3xl border border-white/10">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6">
            <div>
              <h2 className="font-sans text-xl font-semibold text-white md:text-2xl">
                Agents Hub
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Ежедневные задачи, агенты и мозг проекта
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

          <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
            {error ? (
              <div
                className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-100"
                role="alert"
              >
                {error}
              </div>
            ) : null}

            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-xs text-slate-400">Цель года</p>
                <p className="mt-1 text-sm font-medium text-white">
                  {loadingInitial
                    ? "Загрузка…"
                    : (state?.goalYear?.title ?? "not set")}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-xs text-slate-400">Фокус недели</p>
                <p className="mt-1 text-sm font-medium text-white">
                  {loadingInitial
                    ? "Загрузка…"
                    : (state?.focusWeek?.title ?? "not set")}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-xs text-slate-400">Задачи</p>
                <p className="mt-1 text-sm font-medium text-white">
                  {tasks.length} всего · {doneTasks} готово
                </p>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-semibold text-white">Задачи дня</h3>
              {tasks.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">
                  Задачи дня пока не заданы
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {tasks.map((task) => (
                    <li
                      key={task.id}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
                    >
                      <p className="font-medium text-white">{task.title}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {task.status} · {task.source}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(200px,260px)_1fr]">
              <aside>
                <h3 className="mb-2 text-sm font-semibold text-white">Агенты</h3>
                {agents.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    {loadingInitial ? "Загрузка…" : "Агенты не найдены"}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {agents.map((agent) => {
                      const active = agent.key === selectedAgentKey;
                      return (
                        <li key={agent.key}>
                          <button
                            type="button"
                            onClick={() => setSelectedAgentKey(agent.key)}
                            className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                              active
                                ? "border-cyan-400/40 bg-cyan-500/10"
                                : "border-white/10 bg-white/[0.03] hover:border-white/20"
                            }`}
                          >
                            <p className="text-sm font-medium text-white">
                              {agent.name}
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">
                              {agent.role}
                            </p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </aside>

              <div className="flex min-h-[320px] flex-col rounded-2xl border border-white/10 bg-white/[0.02]">
                <div className="border-b border-white/10 px-4 py-3">
                  {selectedAgent ? (
                    <>
                      <p className="text-sm font-semibold text-white">
                        {selectedAgent.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {selectedAgent.role}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-slate-400">Выберите агента</p>
                  )}
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  {loadingMessages ? (
                    <p className="text-sm text-slate-400">Загрузка истории…</p>
                  ) : messages.length === 0 ? (
                    <p className="text-sm text-slate-400">
                      Сообщений пока нет. Напишите агенту ниже.
                    </p>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex flex-col gap-2 ${
                          message.role === "user" ? "items-end" : "items-start"
                        }`}
                      >
                        <p className="text-xs text-slate-500">
                          {message.role === "user"
                            ? "Ты"
                            : (selectedAgent?.name ?? "Агент")}
                        </p>
                        <div
                          className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
                            message.role === "user"
                              ? "bg-cyan-600/20 text-cyan-50"
                              : "bg-white/10 text-white"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                        {message.role === "assistant" ? (
                          <button
                            type="button"
                            onClick={() => openLogForm(message)}
                            className="text-xs text-cyan-300/90 underline-offset-2 hover:underline"
                          >
                            Записать в мозг
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                <div className="border-t border-white/10 p-4">
                  <textarea
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    rows={3}
                    placeholder="Сообщение агенту…"
                    disabled={!selectedAgentKey || sending}
                    className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none disabled:opacity-50"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleSendMessage()}
                      disabled={
                        sending ||
                        !selectedAgentKey ||
                        !messageInput.trim()
                      }
                      className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sending ? "Отправка…" : "Отправить"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {logMessage ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <h3 className="text-sm font-semibold text-white">
                  Записать в мозг
                </h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    Тип
                    <select
                      value={logEntryType}
                      onChange={(e) =>
                        setLogEntryType(e.target.value as BrainLogEntryType)
                      }
                      className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-white"
                    >
                      <option value="decision">decision</option>
                      <option value="insight">insight</option>
                      <option value="worked">worked</option>
                      <option value="not_worked">not_worked</option>
                      <option value="task">task</option>
                      <option value="note">note</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">
                    Title
                    <input
                      type="text"
                      value={logTitle}
                      onChange={(e) => setLogTitle(e.target.value)}
                      className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">
                    Body
                    <textarea
                      value={logBody}
                      onChange={(e) => setLogBody(e.target.value)}
                      rows={4}
                      className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">
                    Tags
                    <input
                      type="text"
                      value={logTags}
                      onChange={(e) => setLogTags(e.target.value)}
                      placeholder="daily, workbench"
                      className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveLog()}
                    disabled={savingLog}
                    className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 disabled:opacity-50"
                  >
                    {savingLog ? "Сохранение…" : "Сохранить"}
                  </button>
                  <button
                    type="button"
                    onClick={closeLogForm}
                    disabled={savingLog}
                    className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:bg-white/5"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
