import { useEffect, useMemo, useState } from "react";
import {
  createWorkflowPlan,
  fetchAgentMessages,
  fetchAgents,
  fetchBrainState,
  fetchWorkflow,
  saveBrainLogEntry,
  sendAgentMessage,
  startWorkflow,
} from "./brainApi";
import type {
  ActivityEntry,
  AgentSummary,
  AgentWorkflow,
  BrainLogEntryType,
  BrainMessage,
  BrainState,
  WorkflowArtifact,
  WorkflowArtifactType,
} from "./brainTypes";

export type AgentsHubPanelProps = {
  onClose: () => void;
  onStateUpdated?: (state: BrainState) => void;
};

const URL_RE = /https?:\/\/[^\s)\]}>'"]+/gi;
const SOURCE_FILE_ACCEPT = ".mp4,.mov,.mp3,.wav,.pdf,.pptx,.txt,.md,.docx,.png,.jpg,.jpeg,.webp";
const IMAGE_FILE_ACCEPT = "image/png,image/jpeg,image/webp";

function cleanAgentText(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\[BRAIN LOG\]/g, "BRAIN LOG:")
    .replace(/────/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitAgentText(text: string): string[] {
  return cleanAgentText(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function AgentMessageBlock({ text }: { text: string }) {
  const blocks = splitAgentText(text);

  return (
    <div className="space-y-2 text-sm text-slate-100">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const isList = lines.length > 1 && lines.every((line) => /^[-✓✅•]|\d+\./.test(line.trim()));

        if (isList) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5 text-slate-200">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {line.replace(/^[-✓✅•]\s*/, "").replace(/^\d+\.\s*/, "")}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="whitespace-pre-wrap leading-relaxed">
            {block}
          </p>
        );
      })}
    </div>
  );
}

function parseReviewText(text: string): {
  status: "passed" | "failed" | "unknown";
  notes: string;
  requiredFix: string;
} {
  const cleaned = cleanAgentText(text);
  const statusMatch = cleaned.match(/REVIEW_STATUS:\s*(passed|failed)/i);
  const status = statusMatch
    ? (statusMatch[1].toLowerCase() as "passed" | "failed")
    : "unknown";

  const notesMatch = cleaned.match(/REVIEW_NOTES:\s*([\s\S]*?)(REQUIRED_FIX:|$)/i);
  const fixMatch = cleaned.match(/REQUIRED_FIX:\s*([\s\S]*)/i);

  return {
    status,
    notes: notesMatch?.[1]?.trim() || cleaned,
    requiredFix: fixMatch?.[1]?.trim() || "none",
  };
}

function ReviewMessageBlock({ text }: { text: string }) {
  const review = parseReviewText(text);
  const passed = review.status === "passed";
  const failed = review.status === "failed";

  return (
    <div
      className={`rounded-xl border p-3 text-sm ${
        passed
          ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50"
          : failed
            ? "border-red-400/20 bg-red-500/10 text-red-50"
            : "border-white/10 bg-white/[0.04] text-slate-100"
      }`}
    >
      <p className="font-semibold">
        {passed ? "Проверка пройдена" : failed ? "Нужна доработка" : "Проверка"}
      </p>

      <div className="mt-2">
        <p className="text-xs opacity-70">Комментарий</p>
        <AgentMessageBlock text={review.notes} />
      </div>

      {review.requiredFix && review.requiredFix.toLowerCase() !== "none" ? (
        <div className="mt-3">
          <p className="text-xs opacity-70">Что исправить</p>
          <AgentMessageBlock text={review.requiredFix} />
        </div>
      ) : null}
    </div>
  );
}

function cleanUrl(raw: string): string {
  return raw.trim().replace(/[.,;!?]+$/g, "");
}

function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    try {
      const url = cleanUrl(match[0]);
      new URL(url);
      urls.add(url);
    } catch {
      // ignore invalid URL-like text
    }
  }
  return [...urls];
}

function classifyUrl(rawUrl: string): WorkflowArtifactType {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const isInstagram = host === "instagram.com" || host === "www.instagram.com" || host === "m.instagram.com";
    if (!isInstagram) return "plain_url";
    const path = url.pathname.toLowerCase().replace(/\/+$/g, "");
    if (/^\/(p|reel|tv)\//.test(path)) return "instagram_post_url";
    if (path && path !== "/" && !path.startsWith("/explore") && !path.startsWith("/accounts")) return "instagram_profile_url";
    return "plain_url";
  } catch {
    return "unknown";
  }
}

function makeArtifact(input: {
  id: string;
  type: WorkflowArtifactType;
  source: WorkflowArtifact["source"];
  title: string;
  summary: string;
  sourceUrl?: string;
  textContent?: string;
  structuredData?: Record<string, unknown>;
}): WorkflowArtifact {
  return {
    ...input,
    createdAt: new Date().toISOString(),
  };
}

function summarizeArtifactForRequest(artifact: WorkflowArtifact): string {
  const lines = [
    `ARTIFACT: ${artifact.title}`,
    `type: ${artifact.type}`,
    `source: ${artifact.source}`,
  ];
  if (artifact.sourceUrl) lines.push(`url: ${artifact.sourceUrl}`);
  lines.push(`summary: ${artifact.summary}`);
  if (artifact.textContent?.trim()) lines.push(`textContent:\n${artifact.textContent.slice(0, 12000)}`);
  if (artifact.structuredData) lines.push(`structuredData:\n${JSON.stringify(artifact.structuredData, null, 2).slice(0, 12000)}`);
  return lines.join("\n");
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string; detail?: string; raw?: string };
      detail = [payload.error, payload.detail, payload.raw].filter(Boolean).join(" — ") || detail;
    } catch {
      try {
        const text = await response.text();
        detail = text || detail;
      } catch {
        // keep fallback
      }
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

function ArtifactBadge({ artifact }: { artifact: WorkflowArtifact }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">
          {artifact.type}
        </span>
        <span className="font-medium text-white">{artifact.title}</span>
      </div>
      <p className="mt-1 text-slate-400">{artifact.summary}</p>
      {artifact.sourceUrl ? <p className="mt-1 break-all text-slate-500">{artifact.sourceUrl}</p> : null}
    </div>
  );
}

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

  const [wfTitle, setWfTitle] = useState("");
  const [wfRequest, setWfRequest] = useState("");
  const [wfSourceFiles, setWfSourceFiles] = useState<File[]>([]);
  const [wfStyleRefs, setWfStyleRefs] = useState<File[]>([]);
  const [wfCharacterRef, setWfCharacterRef] = useState<File | null>(null);
  const [wfPreparedArtifacts, setWfPreparedArtifacts] = useState<WorkflowArtifact[]>([]);
  const [wfArtifactStatus, setWfArtifactStatus] = useState<string | null>(null);
  const [wfActive, setWfActive] = useState<AgentWorkflow | null>(null);
  const [wfPlanning, setWfPlanning] = useState(false);
  const [wfRunning, setWfRunning] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);
  const [wfPollingId, setWfPollingId] = useState<string | null>(null);

  useEffect(() => {
    if (!wfPollingId) return;

    let cancelled = false;
    let timeoutId: number | undefined;

    async function poll() {
      try {
        const latest = await fetchWorkflow(wfPollingId!);
        if (cancelled) return;
        setWfActive(latest);
        const stillRunning =
          latest.status === "running" ||
          latest.status === "reviewing" ||
          latest.status === "revision_required" ||
          latest.status === "planned";
        if (stillRunning) {
          timeoutId = window.setTimeout(() => void poll(), 1200);
          return;
        }
        setWfRunning(false);
        setWfPollingId(null);
      } catch (e) {
        if (cancelled) return;
        setWfRunning(false);
        setWfPollingId(null);
        setWfError(e instanceof Error ? e.message : String(e));
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [wfPollingId]);

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
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingInitial(false);
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
        if (!cancelled) setMessages(nextMessages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingMessages(false);
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
    setLogTitle(selectedAgent?.name ? `Ответ ${selectedAgent.name}` : "Ответ агента");
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

    const tags = logTags.split(",").map((tag) => tag.trim()).filter(Boolean);

    setSavingLog(true);
    setError(null);

    try {
      await saveBrainLogEntry({ agentKey: selectedAgentKey, entryType: logEntryType, title, body, tags });
      closeLogForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLog(false);
    }
  }

  async function prepareArtifacts(userRequest: string): Promise<{ artifacts: WorkflowArtifact[]; preparedRequest: string }> {
    const artifacts: WorkflowArtifact[] = [];

    for (const url of extractUrls(userRequest)) {
      const type = classifyUrl(url);
      if (type === "instagram_post_url") {
        setWfArtifactStatus(`Импортирую Instagram post/reel: ${url}`);
        try {
          const imported = await requestJson<{
            ok: boolean;
            sourceUrl: string;
            caption: string;
            slides: { slideIndex: number; imageUrl: string; type: string }[];
            rawProvider: string;
          }>("/wb/carousel/import-instagram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          setWfArtifactStatus(`Анализирую слайды: ${url}`);
          const analyzed = await requestJson<{ ok: boolean; slides: unknown[] }>("/wb/carousel/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              caption: imported.caption,
              imageUrls: imported.slides.map((slide) => slide.imageUrl),
            }),
          });
          artifacts.push(makeArtifact({
            id: `tool-instagram-carousel-${artifacts.length + 1}`,
            type: "instagram_carousel_analysis",
            source: "tool",
            sourceUrl: url,
            title: "Instagram carousel analysis",
            summary: `Imported ${imported.slides.length} slide(s) via ${imported.rawProvider} and analyzed OCR/visual structure.`,
            textContent: `Caption:\n${imported.caption}\n\nSlides analysis:\n${JSON.stringify(analyzed.slides, null, 2)}`,
            structuredData: { imported, analyzed },
          }));
        } catch (e) {
          artifacts.push(makeArtifact({
            id: `tool-warning-${artifacts.length + 1}`,
            type: "tool_warning",
            source: "tool",
            sourceUrl: url,
            title: "Instagram carousel import/analyze failed",
            summary: e instanceof Error ? e.message : String(e),
          }));
        }
      } else if (type === "instagram_profile_url") {
        artifacts.push(makeArtifact({
          id: `manual-instagram-profile-${artifacts.length + 1}`,
          type: "instagram_profile_snapshot",
          source: "manual",
          sourceUrl: url,
          title: "Instagram profile URL",
          summary: "Profile URL detected. Automatic profile scraping is not implemented yet, so agents must not invent bio, posts, metrics or audience.",
          structuredData: { url, profileScraperStatus: "not_implemented" },
        }));
      }
    }

    for (const file of wfSourceFiles) {
      setWfArtifactStatus(`Извлекаю файл: ${file.name}`);
      const fd = new FormData();
      fd.append("file", file);
      try {
        const extracted = await requestJson<Record<string, unknown>>("/wb/source-rewriter/extract", {
          method: "POST",
          body: fd,
        });
        const fullRawText = typeof extracted.fullRawText === "string" ? extracted.fullRawText : "";
        const transcript = typeof extracted.transcript === "string" ? extracted.transcript : "";
        artifacts.push(makeArtifact({
          id: `tool-extracted-source-${artifacts.length + 1}`,
          type: "extracted_source",
          source: "tool",
          title: `Extracted source: ${file.name}`,
          summary: `Extracted source file via Source Rewriter. fileType=${String(extracted.fileType ?? "unknown")}`,
          textContent: [fullRawText, transcript && transcript !== fullRawText ? transcript : ""].filter(Boolean).join("\n\n"),
          structuredData: extracted,
        }));
      } catch (e) {
        artifacts.push(makeArtifact({
          id: `tool-warning-${artifacts.length + 1}`,
          type: "tool_warning",
          source: "tool",
          title: `Source extraction failed: ${file.name}`,
          summary: e instanceof Error ? e.message : String(e),
        }));
      }
    }

    wfStyleRefs.forEach((file, index) => {
      artifacts.push(makeArtifact({
        id: `style-reference-${index + 1}`,
        type: "style_reference",
        source: "upload",
        title: `Style reference: ${file.name}`,
        summary: "Style reference image was attached in Agents Hub. The file itself is not sent to the LLM in this pass; agents should ask for visual extraction if exact style analysis is required.",
        structuredData: { fileName: file.name, mimeType: file.type, size: file.size },
      }));
    });

    if (wfCharacterRef) {
      artifacts.push(makeArtifact({
        id: "character-reference-1",
        type: "character_reference",
        source: "upload",
        title: `Character reference: ${wfCharacterRef.name}`,
        summary: "Character/person reference image was attached in Agents Hub. The file itself is not sent to the LLM in this pass; agents should ask for visual extraction if identity/style details are required.",
        structuredData: { fileName: wfCharacterRef.name, mimeType: wfCharacterRef.type, size: wfCharacterRef.size },
      }));
    }

    const artifactBlock = artifacts.length
      ? `\n\n--- ПОДТВЕРЖДЁННЫЕ АРТЕФАКТЫ, ПОДГОТОВЛЕННЫЕ AGENTS HUB ---\n${artifacts.map(summarizeArtifactForRequest).join("\n\n---\n\n")}`
      : "";

    return { artifacts, preparedRequest: `${userRequest}${artifactBlock}` };
  }

  async function handleWorkflowPlan() {
    const title = wfTitle.trim();
    const userRequest = wfRequest.trim();
    if (!title || !userRequest) {
      setWfError("Укажи заголовок и описание задачи");
      return;
    }
    setWfPlanning(true);
    setWfError(null);
    setWfArtifactStatus(null);
    setWfPreparedArtifacts([]);
    try {
      const prepared = await prepareArtifacts(userRequest);
      setWfPreparedArtifacts(prepared.artifacts);
      setWfArtifactStatus(prepared.artifacts.length ? "Артефакты подготовлены и добавлены в задачу" : "Дополнительные артефакты не найдены");
      const wf = await createWorkflowPlan({ title, userRequest: prepared.preparedRequest });
      setWfActive(wf);
    } catch (e) {
      setWfError(e instanceof Error ? e.message : String(e));
    } finally {
      setWfPlanning(false);
    }
  }

  async function handleWorkflowRun() {
    if (!wfActive?.id) return;
    setWfRunning(true);
    setWfError(null);
    try {
      await startWorkflow(wfActive.id);
      const latest = await fetchWorkflow(wfActive.id);
      setWfActive(latest);
      setWfPollingId(wfActive.id);
    } catch (e) {
      setWfRunning(false);
      setWfPollingId(null);
      setWfError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-xl" role="dialog" aria-modal="true" aria-label="Agents Hub">
      <div className="mx-auto flex min-h-full max-w-7xl items-center justify-center">
        <section className="card-glass flex max-h-[min(92vh,940px)] w-full flex-col overflow-hidden rounded-3xl border border-white/10">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6">
            <div>
              <h2 className="font-sans text-xl font-semibold text-white md:text-2xl">Agents Hub</h2>
              <p className="mt-1 text-sm text-slate-400">Ежедневные задачи, агенты, артефакты и мозг проекта</p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white">Закрыть</button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
            {error ? <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-100" role="alert">{error}</div> : null}
            {wfError ? <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100" role="status">{wfError}</div> : null}

            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className="text-xs text-slate-400">Цель года</p><p className="mt-1 text-sm font-medium text-white">{loadingInitial ? "Загрузка…" : (state?.goalYear?.title ?? "not set")}</p></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className="text-xs text-slate-400">Фокус недели</p><p className="mt-1 text-sm font-medium text-white">{loadingInitial ? "Загрузка…" : (state?.focusWeek?.title ?? "not set")}</p></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className="text-xs text-slate-400">Задачи</p><p className="mt-1 text-sm font-medium text-white">{tasks.length} всего · {doneTasks} готово</p></div>
            </div>

            <div className="mb-6 rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4">
              <h3 className="text-base font-semibold text-white">Запустить задачу через Chief</h3>
              <p className="mt-1 text-sm text-slate-400">Chief формирует постановку, Agents Hub заранее извлекает доступные файлы/ссылки и передаёт подтверждённые артефакты в цепочку.</p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-slate-400">Заголовок<input type="text" value={wfTitle} onChange={(e) => setWfTitle(e.target.value)} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" placeholder="Краткий заголовок задачи" /></label>
                <div className="hidden md:block" />
                <label className="flex flex-col gap-1 text-xs text-slate-400 md:col-span-2">Запрос<textarea value={wfRequest} onChange={(e) => setWfRequest(e.target.value)} rows={4} className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" placeholder="Опиши задачу. Можно вставить Instagram URL, приложить PDF/видео/картинку ниже…" /></label>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-slate-400">Файлы для Source Rewriter<input type="file" accept={SOURCE_FILE_ACCEPT} multiple onChange={(e) => setWfSourceFiles(Array.from(e.target.files ?? []))} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white" /></label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">Style reference<input type="file" accept={IMAGE_FILE_ACCEPT} multiple onChange={(e) => setWfStyleRefs(Array.from(e.target.files ?? []).slice(0, 5))} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white" /></label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">Character reference<input type="file" accept={IMAGE_FILE_ACCEPT} onChange={(e) => setWfCharacterRef(e.target.files?.[0] ?? null)} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white" /></label>
              </div>

              {(wfSourceFiles.length > 0 || wfStyleRefs.length > 0 || wfCharacterRef) ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                  {wfSourceFiles.map((f) => <span key={`src-${f.name}-${f.size}`} className="rounded-full border border-white/10 px-2 py-1">source: {f.name}</span>)}
                  {wfStyleRefs.map((f) => <span key={`style-${f.name}-${f.size}`} className="rounded-full border border-white/10 px-2 py-1">style: {f.name}</span>)}
                  {wfCharacterRef ? <span className="rounded-full border border-white/10 px-2 py-1">character: {wfCharacterRef.name}</span> : null}
                </div>
              ) : null}

              {wfArtifactStatus ? <p className="mt-3 text-xs text-cyan-200">{wfArtifactStatus}</p> : null}
              {wfPreparedArtifacts.length > 0 ? <div className="mt-3 grid gap-2 md:grid-cols-2">{wfPreparedArtifacts.map((artifact) => <ArtifactBadge key={artifact.id} artifact={artifact} />)}</div> : null}
              {(wfActive?.artifacts?.length ?? 0) > 0 ? <div className="mt-3 grid gap-2 md:grid-cols-2">{(wfActive?.artifacts ?? []).map((artifact) => <ArtifactBadge key={artifact.id} artifact={artifact} />)}</div> : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleWorkflowPlan()} disabled={wfPlanning} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50">{wfPlanning ? "Готовлю артефакты…" : "Разобрать задачу"}</button>
                <button type="button" onClick={() => void handleWorkflowRun()} disabled={wfRunning || !wfActive?.id || wfActive.status !== "planned"} className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50">{wfRunning ? "Выполняется…" : "Запустить цепочку агентов"}</button>
              </div>

              {wfActive?.currentActivity ? <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-3"><p className="text-xs font-medium text-cyan-300">Сейчас</p><p className="mt-1 text-sm text-white">{wfActive.currentActivity}</p></div> : null}

              {(wfActive?.activityLog?.length ?? 0) > 0 ? <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs font-medium text-slate-300">Живой журнал{wfRunning ? <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400 align-middle" /> : null}</p><div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">{(wfActive?.activityLog ?? []).slice(-30).map((entry: ActivityEntry) => <ActivityRow key={entry.id} entry={entry} />)}</div></div> : null}

              {wfActive?.ceoPlan ? <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs font-medium text-cyan-300/90">План Chief</p><div className="mt-2 max-h-48 overflow-y-auto pr-2"><AgentMessageBlock text={wfActive.ceoPlan} /></div></div> : null}

              {wfActive && wfActive.steps.length > 0 ? <div className="mt-4 space-y-2"><p className="text-xs font-medium text-slate-400">Шаги</p><ul className="space-y-1.5">{wfActive.steps.map((step, idx) => <StepRow key={step.id} step={step} idx={idx} isActive={step.status === "running" || step.status === "reviewing"} isDone={step.status === "completed"} isFailed={step.status === "failed" || step.status === "revision_required"} />)}</ul></div> : null}

              {wfActive?.finalResult ? <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-950/30 p-3"><p className="text-xs font-semibold text-emerald-300">✅ Финальный результат</p><div className="mt-2 max-h-72 overflow-y-auto pr-2"><AgentMessageBlock text={wfActive.finalResult} /></div></div> : null}
              {wfActive?.status === "failed" && wfActive.error ? <div className="mt-2 rounded-xl border border-red-400/20 bg-red-950/20 p-3"><p className="text-xs font-semibold text-red-300">Ошибка</p><div className="mt-1">{/REVIEW_STATUS:/i.test(wfActive.error) ? <ReviewMessageBlock text={wfActive.error} /> : <p className="text-sm text-red-200">{wfActive.error}</p>}</div></div> : null}
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-semibold text-white">Задачи дня</h3>
              {tasks.length === 0 ? <p className="mt-2 text-sm text-slate-400">Задачи дня пока не заданы</p> : <ul className="mt-2 space-y-2">{tasks.map((task) => <li key={task.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"><p className="font-medium text-white">{task.title}</p><p className="mt-0.5 text-xs text-slate-400">{task.status} · {task.source}</p></li>)}</ul>}
            </div>

            <h3 className="mb-2 text-sm font-semibold text-white">Ручной чат с агентом</h3>
            <div className="grid gap-4 lg:grid-cols-[minmax(200px,260px)_1fr]">
              <aside>
                <h3 className="mb-2 text-sm font-semibold text-white">Агенты</h3>
                {agents.length === 0 ? <p className="text-sm text-slate-400">{loadingInitial ? "Загрузка…" : "Агенты не найдены"}</p> : <ul className="space-y-2">{agents.map((agent) => { const active = agent.key === selectedAgentKey; return <li key={agent.key}><button type="button" onClick={() => setSelectedAgentKey(agent.key)} className={`w-full rounded-xl border px-3 py-2 text-left transition ${active ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/10 bg-white/[0.03] hover:border-white/20"}`}><p className="text-sm font-medium text-white">{agent.name}</p><p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{agent.role}</p></button></li>; })}</ul>}
              </aside>

              <div className="flex min-h-[320px] flex-col rounded-2xl border border-white/10 bg-white/[0.02]">
                <div className="border-b border-white/10 px-4 py-3">{selectedAgent ? <><p className="text-sm font-semibold text-white">{selectedAgent.name}</p><p className="mt-0.5 text-xs text-slate-400">{selectedAgent.role}</p></> : <p className="text-sm text-slate-400">Выберите агента</p>}</div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{loadingMessages ? <p className="text-sm text-slate-400">Загрузка истории…</p> : messages.length === 0 ? <p className="text-sm text-slate-400">Сообщений пока нет. Напишите агенту ниже.</p> : messages.map((message) => <div key={message.id} className={`flex flex-col gap-2 ${message.role === "user" ? "items-end" : "items-start"}`}><p className="text-xs text-slate-500">{message.role === "user" ? "Ты" : (selectedAgent?.name ?? "Агент")}</p><div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${message.role === "user" ? "bg-cyan-600/20 text-cyan-50" : "bg-white/10 text-white"}`}><p className="whitespace-pre-wrap">{message.content}</p></div>{message.role === "assistant" ? <button type="button" onClick={() => openLogForm(message)} className="text-xs text-cyan-300/90 underline-offset-2 hover:underline">Записать в мозг</button> : null}</div>)}</div>
                <div className="border-t border-white/10 p-4"><textarea value={messageInput} onChange={(e) => setMessageInput(e.target.value)} rows={3} placeholder="Сообщение агенту…" disabled={!selectedAgentKey || sending} className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none disabled:opacity-50" /><div className="mt-2 flex justify-end"><button type="button" onClick={() => void handleSendMessage()} disabled={sending || !selectedAgentKey || !messageInput.trim()} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50">{sending ? "Отправка…" : "Отправить"}</button></div></div>
              </div>
            </div>

            {logMessage ? <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4"><h3 className="text-sm font-semibold text-white">Записать в мозг</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-xs text-slate-400">Тип<select value={logEntryType} onChange={(e) => setLogEntryType(e.target.value as BrainLogEntryType)} className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-white"><option value="decision">decision</option><option value="insight">insight</option><option value="worked">worked</option><option value="not_worked">not_worked</option><option value="task">task</option><option value="note">note</option></select></label><label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">Title<input type="text" value={logTitle} onChange={(e) => setLogTitle(e.target.value)} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" /></label><label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">Body<textarea value={logBody} onChange={(e) => setLogBody(e.target.value)} rows={4} className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" /></label><label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">Tags<input type="text" value={logTags} onChange={(e) => setLogTags(e.target.value)} placeholder="daily, workbench" className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500" /></label></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void handleSaveLog()} disabled={savingLog} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 disabled:opacity-50">{savingLog ? "Сохранение…" : "Сохранить"}</button><button type="button" onClick={closeLogForm} disabled={savingLog} className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:bg-white/5">Отмена</button></div></div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

const AGENT_COLORS: Record<string, string> = {
  chief: "text-cyan-300",
  marketer: "text-amber-300",
  content_maker: "text-emerald-300",
  analyst: "text-violet-300",
  copywriter: "text-pink-300",
  system: "text-slate-400",
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

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isSystem = entry.agentKey === "system";
  const color = AGENT_COLORS[entry.agentKey] ?? "text-slate-400";
  const label = AGENT_LABELS[entry.agentKey] ?? entry.agentKey;
  const icon = PHASE_ICONS[entry.phase] ?? "·";
  const isLong = entry.text.length > 220;

  if (isSystem) {
    return <div className="flex items-center gap-1.5 py-0.5"><span className="text-[10px] text-slate-600">{icon}</span><span className="text-[11px] text-slate-500">{entry.text}</span></div>;
  }

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
      <div className="flex items-center gap-1.5"><span className="text-xs leading-none">{icon}</span><span className={`text-[11px] font-semibold ${color}`}>{label}</span><span className="text-[10px] text-slate-600">· {entry.phase}</span></div>
      {entry.text ? <div className={`mt-1 text-[11px] ${!expanded && isLong ? "line-clamp-4" : ""}`}>{entry.phase === "review" ? <ReviewMessageBlock text={entry.text} /> : <AgentMessageBlock text={entry.text} />}{isLong ? <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-0.5 text-[10px] text-cyan-400 hover:underline">{expanded ? "Свернуть ▲" : "Развернуть ▼"}</button> : null}</div> : null}
    </div>
  );
}

type StepRowProps = {
  step: {
    id: string;
    agentKey: string;
    reviewerKey: string | null;
    title: string;
    status: string;
    reviewStatus: string;
    output: string | null;
    reviewOutput: string | null;
  };
  idx: number;
  isActive: boolean;
  isDone: boolean;
  isFailed: boolean;
};

function StepRow({ step, idx, isActive, isDone, isFailed }: StepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const color = AGENT_COLORS[step.agentKey] ?? "text-slate-300";
  const label = AGENT_LABELS[step.agentKey] ?? step.agentKey;
  const hasOutput = !!(step.output || step.reviewOutput);

  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
      <div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${isActive ? "animate-pulse bg-cyan-400" : isDone ? "bg-emerald-400" : isFailed ? "bg-red-400" : "bg-slate-600"}`} /><span className="text-slate-500">{idx + 1}.</span><span className={`font-semibold ${color}`}>{label}</span><span className="truncate text-slate-300">{step.title}</span>{step.reviewerKey ? <span className="ml-auto shrink-0 text-[10px] text-slate-600">rev: {AGENT_LABELS[step.reviewerKey] ?? step.reviewerKey}</span> : null}</div>
      {hasOutput ? <div className="mt-1.5"><button type="button" onClick={() => setExpanded((v) => !v)} className="text-[10px] text-cyan-400/70 hover:underline">{expanded ? "Скрыть ▲" : "Показать вывод ▼"}</button>{expanded ? <div className="mt-1 space-y-1">{step.output ? <div className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-black/20 p-3"><AgentMessageBlock text={step.output} /></div> : null}{step.reviewOutput ? <div className="mt-2"><ReviewMessageBlock text={step.reviewOutput} /></div> : null}</div> : null}</div> : null}
    </li>
  );
}
