import { useEffect, useMemo, useState } from "react";
import {
  createWorkflowPlan,
  fetchWorkflow,
  startWorkflow,
} from "./brainApi";
import type {
  AgentWorkflow,
  BrainState,
  WorkflowArtifact,
  WorkflowArtifactType,
} from "./brainTypes";
import type { ExtractedSource, RewrittenSource, RewriteMode } from "./sourceRewriterTypes";

export type AgentsHubPanelProps = {
  onClose: () => void;
  onStateUpdated?: (state: BrainState) => void;
};

const URL_RE = /https?:\/\/[^\s)\]}>'"]+/gi;
const SOURCE_FILE_ACCEPT = ".mp4,.mov,.mp3,.wav,.pdf,.pptx,.txt,.md,.docx,.png,.jpg,.jpeg,.webp";
const IMAGE_FILE_ACCEPT = "image/png,image/jpeg,image/webp";
const PREPARED_MARKER = "--- ПОДТВЕРЖДЁННЫЕ АРТЕФАКТЫ, ПОДГОТОВЛЕННЫЕ AGENTS HUB ---";

type InstagramImportResult = {
  ok: boolean;
  sourceUrl: string;
  caption: string;
  slides: { slideIndex: number; imageUrl: string; type: string }[];
  rawProvider: string;
};

type InstagramAnalyzeResult = {
  ok: boolean;
  slides: unknown[];
};

type CarouselRewriteResult = {
  ok: boolean;
  slides: { slideIndex: number; rewrittenText: string; generationPrompt: string }[];
  rewrittenCaption: string;
};

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
      // ignore
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
  return { ...input, createdAt: new Date().toISOString() };
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string; detail?: string; raw?: string };
      detail = [payload.error, payload.detail, payload.raw].filter(Boolean).join(" — ") || detail;
    } catch {
      const text = await response.text().catch(() => "");
      detail = text || detail;
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

function isCarouselRequest(text: string): boolean {
  return /карусел|слайд|carousel/i.test(text);
}

function detectCta(text: string): string {
  const match = text.match(/(?:cta|кодовое слово|ключевое слово|стоп-слово|пиши|напиши)\s*[:：-]?\s*["«]?([А-ЯA-Z0-9_\- ]{2,40})["»]?/i);
  return match?.[1]?.trim() || "Сохрани и напиши ключевое слово в комментарии, чтобы забрать инструкцию.";
}

function inferRewriteMode(text: string): RewriteMode {
  const q = text.toLowerCase();
  if (isCarouselRequest(q)) return "carousel_script";
  if (/instagram|инстаграм|caption|подпись/.test(q)) return "instagram_post";
  if (/telegram|телеграм/.test(q)) return "telegram_post";
  if (/документ|pdf|word|docx|презентац|таблиц|так(ой|ая|ое) же|сохрани структуру/.test(q)) return "preserve_original_structure";
  if (/урок|обуч|материал/.test(q)) return "lesson_material";
  if (/статья|article/.test(q)) return "clean_article";
  return "preserve_original_structure";
}

function autoTitle(request: string): string {
  const clean = request.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 80) : "Задача Agents Hub";
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

function formatCarouselPipelineResult(rewritten: RewrittenSource): string {
  const pages = rewritten.rewrittenCarouselPages ?? [];
  return [
    "ГОТОВЫЕ СЛАЙДЫ:",
    ...pages.map((page) => `Слайд ${page.pageNumber} (${page.role}):\n${page.rewrittenText}\n\nVisual prompt:\n${page.visualPrompt}`),
    "",
    "КОРОТКАЯ ПОДПИСЬ / CAPTION:",
    rewritten.rewrittenCaption || "",
    "",
    "GPT PROMPT PACK:",
    rewritten.carouselPromptPack || "",
  ].join("\n\n");
}

function buildInstagramPromptPack(rewritten: CarouselRewriteResult, styleNotes: string): string {
  return [
    "Создай готовую Instagram-карусель 4:5.",
    "Это полностью готовые публикуемые слайды, не черновик.",
    "Используй текст слайдов точно. Не добавляй неподтверждённые факты.",
    styleNotes ? `Стиль/референсы: ${styleNotes}` : "Стиль: современный, чистый, контрастный, читаемый.",
    "",
    ...rewritten.slides.map((slide) => `СЛАЙД ${slide.slideIndex}\nТекст: ${slide.rewrittenText}\nВизуал: ${slide.generationPrompt}`),
    "",
    `Caption: ${rewritten.rewrittenCaption}`,
  ].join("\n\n");
}

async function extractFile(file: File): Promise<ExtractedSource> {
  const fd = new FormData();
  fd.append("file", file);
  return requestJson<ExtractedSource>("/wb/source-rewriter/extract", { method: "POST", body: fd });
}

async function rewriteSource(extracted: ExtractedSource, request: string, styleNotes: string): Promise<RewrittenSource> {
  const rewriteMode = inferRewriteMode(request);
  return requestJson<RewrittenSource>("/wb/source-rewriter/rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      extractedSource: extracted,
      editedSource: extracted,
      settings: {
        rewriteMode,
        outputLength: "keep_similar_length",
        styleIntensity: "strong_rewrite",
        plagiarismSafety: "maximum_uniqueness_without_losing_meaning",
        carouselSlideCount: 6,
        carouselMaxCharsPerSlide: 140,
        carouselCtaText: detectCta(request),
        carouselStyleNotes: styleNotes,
      },
    }),
  });
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

export function AgentsHubPanel({ onClose }: AgentsHubPanelProps) {
  const [request, setRequest] = useState("");
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [styleRefs, setStyleRefs] = useState<File[]>([]);
  const [characterRef, setCharacterRef] = useState<File | null>(null);
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<AgentWorkflow | null>(null);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingId, setPollingId] = useState<string | null>(null);

  const styleNotes = useMemo(() => {
    const names = styleRefs.map((file) => file.name).join(", ");
    return names ? `Пользователь приложил style reference: ${names}. Учитывай как визуальное направление.` : "";
  }, [styleRefs]);

  useEffect(() => {
    if (!pollingId) return;
    const workflowId = pollingId;
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      try {
        const latest = await fetchWorkflow(workflowId);
        if (cancelled) return;
        setWorkflow(latest);
        if (latest.status === "running" || latest.status === "reviewing" || latest.status === "revision_required" || latest.status === "planned") {
          timer = window.setTimeout(() => void poll(), 1300);
          return;
        }
        setRunning(false);
        setPollingId(null);
      } catch (e) {
        if (cancelled) return;
        setRunning(false);
        setPollingId(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pollingId]);

  async function prepareArtifacts(userRequest: string): Promise<{ preparedArtifacts: WorkflowArtifact[]; preparedRequest: string }> {
    const nextArtifacts: WorkflowArtifact[] = [];
    const carouselMode = isCarouselRequest(userRequest);

    for (const url of extractUrls(userRequest)) {
      const type = classifyUrl(url);
      if (type === "instagram_post_url") {
        setStatus(`Instagram Carousel Remix: импортирую ${url}`);
        try {
          const imported = await requestJson<InstagramImportResult>("/wb/carousel/import-instagram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          setStatus("Instagram Carousel Remix: анализирую слайды");
          const analyzed = await requestJson<InstagramAnalyzeResult>("/wb/carousel/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caption: imported.caption, imageUrls: imported.slides.map((slide) => slide.imageUrl) }),
          });
          nextArtifacts.push(makeArtifact({
            id: `instagram-analysis-${nextArtifacts.length + 1}`,
            type: "instagram_carousel_analysis",
            source: "tool",
            sourceUrl: url,
            title: "Instagram carousel analysis",
            summary: `Imported ${imported.slides.length} slide(s) and analyzed OCR/visual structure.`,
            textContent: `Caption:\n${imported.caption}\n\nSlides analysis:\n${JSON.stringify(analyzed.slides, null, 2)}`,
            structuredData: { imported, analyzed },
          }));

          setStatus("Instagram Carousel Remix: переписываю карусель");
          const rewritten = await requestJson<CarouselRewriteResult>("/wb/carousel/rewrite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caption: imported.caption, style: styleNotes, slides: analyzed.slides }),
          });
          const promptPack = buildInstagramPromptPack(rewritten, styleNotes);
          nextArtifacts.push(makeArtifact({
            id: `instagram-carousel-result-${nextArtifacts.length + 1}`,
            type: "source_rewriter_carousel_result",
            source: "tool",
            sourceUrl: url,
            title: "Instagram Carousel Remix result",
            summary: `Ready carousel pipeline result: ${rewritten.slides.length} slides, caption and GPT prompt pack.`,
            textContent: [
              "ГОТОВЫЕ СЛАЙДЫ:",
              ...rewritten.slides.map((slide) => `Слайд ${slide.slideIndex}:\n${slide.rewrittenText}\n\nVisual prompt:\n${slide.generationPrompt}`),
              "",
              "КОРОТКАЯ ПОДПИСЬ / CAPTION:",
              rewritten.rewrittenCaption,
              "",
              "GPT PROMPT PACK:",
              promptPack,
            ].join("\n\n"),
            structuredData: { rewritten, carouselPromptPack: promptPack },
          }));
        } catch (e) {
          nextArtifacts.push(makeArtifact({
            id: `instagram-warning-${nextArtifacts.length + 1}`,
            type: "tool_warning",
            source: "tool",
            sourceUrl: url,
            title: "Instagram Carousel Remix failed",
            summary: e instanceof Error ? e.message : String(e),
          }));
        }
      } else if (type === "instagram_profile_url") {
        nextArtifacts.push(makeArtifact({
          id: `instagram-profile-${nextArtifacts.length + 1}`,
          type: "instagram_profile_snapshot",
          source: "manual",
          sourceUrl: url,
          title: "Instagram profile URL",
          summary: "Profile URL detected. Profile scraping is not connected, so agents must not invent bio, posts, metrics or audience.",
          structuredData: { url, profileScraperStatus: "not_connected" },
        }));
      }
    }

    for (const file of styleRefs) {
      setStatus(`Извлекаю style reference: ${file.name}`);
      try {
        const extracted = await extractFile(file);
        nextArtifacts.push(makeArtifact({
          id: `style-ref-${nextArtifacts.length + 1}`,
          type: "style_reference",
          source: "upload",
          title: `Style reference: ${file.name}`,
          summary: "Style reference extracted through Source Rewriter visual/text extraction.",
          textContent: extracted.fullRawText,
          structuredData: { extracted },
        }));
      } catch (e) {
        nextArtifacts.push(makeArtifact({
          id: `style-warning-${nextArtifacts.length + 1}`,
          type: "tool_warning",
          source: "tool",
          title: `Style reference extraction failed: ${file.name}`,
          summary: e instanceof Error ? e.message : String(e),
        }));
      }
    }

    if (characterRef) {
      setStatus(`Извлекаю character reference: ${characterRef.name}`);
      try {
        const extracted = await extractFile(characterRef);
        nextArtifacts.push(makeArtifact({
          id: `character-ref-${nextArtifacts.length + 1}`,
          type: "character_reference",
          source: "upload",
          title: `Character reference: ${characterRef.name}`,
          summary: "Character reference extracted for safe visual description. Identity is not recognized by name.",
          textContent: extracted.fullRawText,
          structuredData: { extracted },
        }));
      } catch (e) {
        nextArtifacts.push(makeArtifact({
          id: `character-warning-${nextArtifacts.length + 1}`,
          type: "tool_warning",
          source: "tool",
          title: `Character reference extraction failed: ${characterRef.name}`,
          summary: e instanceof Error ? e.message : String(e),
        }));
      }
    }

    for (const file of sourceFiles) {
      setStatus(`Source Rewriter: извлекаю файл ${file.name}`);
      try {
        const extracted = await extractFile(file);
        nextArtifacts.push(makeArtifact({
          id: `source-extracted-${nextArtifacts.length + 1}`,
          type: "extracted_source",
          source: "tool",
          title: `Extracted source: ${file.name}`,
          summary: `Source Rewriter extract complete. fileType=${extracted.fileType}.`,
          textContent: [extracted.fullRawText, extracted.transcript && extracted.transcript !== extracted.fullRawText ? extracted.transcript : ""].filter(Boolean).join("\n\n"),
          structuredData: { extractedSource: extracted },
        }));

        setStatus(`Source Rewriter: переписываю ${file.name}`);
        const rewritten = await rewriteSource(extracted, userRequest, styleNotes);
        if (carouselMode && rewritten.rewriteMode === "carousel_script") {
          nextArtifacts.push(makeArtifact({
            id: `source-carousel-result-${nextArtifacts.length + 1}`,
            type: "source_rewriter_carousel_result",
            source: "tool",
            title: `Source Rewriter carousel result: ${file.name}`,
            summary: `Ready Source Rewriter carousel pipeline result: ${(rewritten.rewrittenCarouselPages ?? []).length} slides, caption and GPT prompt pack.`,
            textContent: formatCarouselPipelineResult(rewritten),
            structuredData: { rewrittenSource: rewritten },
          }));
        } else {
          nextArtifacts.push(makeArtifact({
            id: `source-rewrite-result-${nextArtifacts.length + 1}`,
            type: "extracted_source",
            source: "tool",
            title: `Source Rewriter result: ${file.name}`,
            summary: `Source Rewriter rewrite complete. mode=${rewritten.rewriteMode}.`,
            textContent: rewritten.fullRewrittenText,
            structuredData: { rewrittenSource: rewritten },
          }));
        }
      } catch (e) {
        nextArtifacts.push(makeArtifact({
          id: `source-warning-${nextArtifacts.length + 1}`,
          type: "tool_warning",
          source: "tool",
          title: `Source Rewriter failed: ${file.name}`,
          summary: e instanceof Error ? e.message : String(e),
        }));
      }
    }

    const artifactBlock = nextArtifacts.length
      ? `\n\n${PREPARED_MARKER}\n${nextArtifacts.map(summarizeArtifactForRequest).join("\n\n---\n\n")}`
      : "";
    const pipelineInstruction = carouselMode
      ? "\n\nОБЯЗАТЕЛЬНО: если среди артефактов есть source_rewriter_carousel_result, финальный ответ должен взять именно его: готовые слайды, короткую подпись/CAPTION и GPT PROMPT PACK. Не придумывай карусель заново."
      : "";

    return { preparedArtifacts: nextArtifacts, preparedRequest: `${userRequest}${pipelineInstruction}${artifactBlock}` };
  }

  async function handlePlan() {
    const userRequest = request.trim();
    if (!userRequest) {
      setError("Напиши задачу в поле запроса");
      return;
    }
    setPlanning(true);
    setError(null);
    setStatus(null);
    setArtifacts([]);
    setWorkflow(null);
    try {
      const prepared = await prepareArtifacts(userRequest);
      setArtifacts(prepared.preparedArtifacts);
      setStatus(prepared.preparedArtifacts.length ? "Артефакты подготовлены и добавлены в задачу" : "Запускаю без дополнительных артефактов");
      const wf = await createWorkflowPlan({ title: autoTitle(userRequest), userRequest: prepared.preparedRequest, artifacts: prepared.preparedArtifacts });
      setWorkflow(wf);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  }

  async function handleRun() {
    if (!workflow?.id) return;
    setRunning(true);
    setError(null);
    try {
      await startWorkflow(workflow.id);
      const latest = await fetchWorkflow(workflow.id);
      setWorkflow(latest);
      setPollingId(workflow.id);
    } catch (e) {
      setRunning(false);
      setPollingId(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-xl" role="dialog" aria-modal="true" aria-label="Agents Hub">
      <div className="mx-auto flex min-h-full max-w-7xl items-center justify-center">
        <section className="card-glass flex max-h-[min(92vh,940px)] w-full flex-col overflow-hidden rounded-3xl border border-white/10">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6">
            <div>
              <h2 className="font-sans text-xl font-semibold text-white md:text-2xl">Agents Hub</h2>
              <p className="mt-1 text-sm text-slate-400">Чат-задача → Source Rewriter / Instagram Remix → агенты → финальный результат</p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white">Закрыть</button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
            {error ? <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-100">{error}</div> : null}

            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4">
              <h3 className="text-base font-semibold text-white">Задача для Jarvis</h3>
              <p className="mt-1 text-sm text-slate-400">Одно поле. Пиши по-человечески: “создай карусель”, “сделай документ”, “перепиши под меня”. Файлы и ссылки уйдут в нужный pipeline.</p>

              <label className="mt-4 flex flex-col gap-1 text-xs text-slate-400">Запрос<textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={5} className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" placeholder="Например: Создай карусель из этого видео. CTA: ФОТО" /></label>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-slate-400">Файлы / источники<input type="file" accept={SOURCE_FILE_ACCEPT} multiple onChange={(e) => setSourceFiles(Array.from(e.target.files ?? []))} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white" /></label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">Style reference<input type="file" accept={IMAGE_FILE_ACCEPT} multiple onChange={(e) => setStyleRefs(Array.from(e.target.files ?? []).slice(0, 5))} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white" /></label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">Character reference<input type="file" accept={IMAGE_FILE_ACCEPT} onChange={(e) => setCharacterRef(e.target.files?.[0] ?? null)} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white" /></label>
              </div>

              {(sourceFiles.length > 0 || styleRefs.length > 0 || characterRef) ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                  {sourceFiles.map((f) => <span key={`src-${f.name}-${f.size}`} className="rounded-full border border-white/10 px-2 py-1">source: {f.name}</span>)}
                  {styleRefs.map((f) => <span key={`style-${f.name}-${f.size}`} className="rounded-full border border-white/10 px-2 py-1">style: {f.name}</span>)}
                  {characterRef ? <span className="rounded-full border border-white/10 px-2 py-1">character: {characterRef.name}</span> : null}
                </div>
              ) : null}

              {status ? <p className="mt-3 text-xs text-cyan-200">{status}</p> : null}
              {artifacts.length > 0 ? <div className="mt-3 grid gap-2 md:grid-cols-2">{artifacts.map((artifact) => <ArtifactBadge key={artifact.id} artifact={artifact} />)}</div> : null}
              {(workflow?.artifacts?.length ?? 0) > 0 ? <div className="mt-3 grid gap-2 md:grid-cols-2">{(workflow?.artifacts ?? []).map((artifact) => <ArtifactBadge key={artifact.id} artifact={artifact} />)}</div> : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void handlePlan()} disabled={planning || running} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50">{planning ? "Готовлю pipeline…" : "Разобрать задачу"}</button>
                <button type="button" onClick={() => void handleRun()} disabled={running || !workflow?.id || workflow.status !== "planned"} className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50">{running ? "Выполняется…" : "Запустить цепочку агентов"}</button>
              </div>
            </div>

            {workflow?.taskCard ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-semibold text-white">Task Card</p>
                <div className="mt-2 grid gap-2 text-xs text-slate-300 md:grid-cols-4">
                  <span>intent: {workflow.taskCard.intent}</span>
                  <span>format: {workflow.taskCard.outputFormat}</span>
                  <span>confidence: {workflow.taskCard.confidence}</span>
                  <span>ask: {String(workflow.taskCard.shouldAskUser)}</span>
                </div>
              </div>
            ) : null}

            {(workflow?.activityLog?.length ?? 0) > 0 ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-semibold text-white">Живой журнал</p>
                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                  {(workflow?.activityLog ?? []).map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-200">
                      <div className="mb-1 flex justify-between gap-2 text-slate-500"><span>{entry.agentKey} · {entry.phase}</span><span>{new Date(entry.ts).toLocaleTimeString("ru-RU")}</span></div>
                      <pre className="whitespace-pre-wrap">{entry.text}</pre>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {workflow?.finalResult ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-950/30 p-4">
                <p className="mb-2 text-sm font-semibold text-emerald-300">Финальный результат</p>
                <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-sm text-white">{workflow.finalResult}</pre>
              </div>
            ) : null}

            {workflow?.status === "failed" && workflow.error ? (
              <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-950/30 p-4 text-sm text-red-100">{workflow.error}</div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
