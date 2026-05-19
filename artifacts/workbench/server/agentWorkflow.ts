import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrainAgent, BrainLogEntry, BrainState } from "./brain";
import {
  getAgentByKey,
  listAgents,
  readBrainLog,
  readBrainState,
  renderStateForAgent,
} from "./brain";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.resolve(__dirname, "..", "data", "brain", "workflows");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkflowStatus =
  | "draft"
  | "planned"
  | "running"
  | "reviewing"
  | "revision_required"
  | "completed"
  | "failed";

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "reviewing"
  | "revision_required"
  | "failed";

export type ReviewStatus = "not_started" | "passed" | "failed";

export type WorkflowAgentKey =
  | "ceo"
  | "operations"
  | "funnel"
  | "content_strategy"
  | "rewriter"
  | "tech_architect";

export type WorkflowMemoryEvent = {
  id: string;
  ts: string;
  agentKey: WorkflowAgentKey;
  type: "plan" | "output" | "review" | "revision" | "final" | "note";
  title: string;
  body: string;
};

export type ActivityPhase =
  | "system"
  | "reading"
  | "thinking"
  | "output"
  | "sending"
  | "review"
  | "revision"
  | "done"
  | "error";

export type ActivityEntry = {
  id: string;
  ts: string;
  agentKey: string;
  phase: ActivityPhase;
  text: string;
};

export type AgentWorkflowStep = {
  id: string;
  agentKey: WorkflowAgentKey;
  reviewerKey: WorkflowAgentKey | null;
  title: string;
  instruction: string;
  status: WorkflowStepStatus;
  output: string | null;
  reviewStatus: ReviewStatus;
  reviewOutput: string | null;
  revisionCount: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type AgentWorkflow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: WorkflowStatus;
  title: string;
  userRequest: string;
  ceoPlan: string | null;
  sharedContextSnapshot: string | null;
  steps: AgentWorkflowStep[];
  memoryEvents: WorkflowMemoryEvent[];
  activityLog: ActivityEntry[];
  currentActivity: string | null;
  finalResult: string | null;
  error: string | null;
};

export type CreateWorkflowPlanInput = {
  title: string;
  userRequest: string;
};

export type WorkflowOpenRouter = {
  complete: (args: {
    model: string;
    system: string;
    user: string;
  }) => Promise<string>;
};

export type WorkflowLiveEventType =
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

export type WorkflowLiveEvent = {
  type: WorkflowLiveEventType;
  ts: string;
  agentKey: string;
  stepTitle?: string;
  stepIndex?: number;
  totalSteps?: number;
  text?: string;
  reviewStatus?: ReviewStatus;
  workflowStatus?: WorkflowStatus;
  finalResult?: string;
  error?: string;
};

export type WorkflowOnEvent = (event: WorkflowLiveEvent) => void;

const WORKFLOW_PROTOCOL = `

WORKFLOW PROTOCOL:
Ты участвуешь в многошаговой задаче. Ты видишь shared context: исходный запрос, план CEO, предыдущие outputs.
Делай только свою роль. Не повторяй то, что уже сделал другой шаг.

ЗАПРЕЩЕНО КАТЕГОРИЧЕСКИ:
- Упоминать других агентов по имени (не пиши "вызови агента funnel", "передай Operations", "обратись к Rewriter").
- Давать задачи типа "запустить агента X", "использовать систему Y", "открыть Agents Hub", "вызвать цепочку".
- Писать задачи для системы — только конкретные действия для Егора лично: написать, опубликовать, снять, записать, созвониться.
- Использовать Markdown-заголовки ## и жирный Markdown **.

ФОРМАТ ОТВЕТА:
Пиши обычным текстом. Каждый ответ содержит:

КРАТКО:
<1–3 предложения — что сделано>

РЕЗУЛЬТАТ:
<основной результат твоей работы — конкретный текст, план, анализ, формулировки>

HANDOFF_SUMMARY:
- что сделано
- что следующему шагу важно знать
- что проверить
`;

const REVIEW_PROTOCOL = `

REVIEW PROTOCOL:
Ты проверяешь output другого агента.
Верни строго:

REVIEW_STATUS: passed | failed
REVIEW_NOTES:
<конкретно что хорошо/плохо>
REQUIRED_FIX:
<если failed — что исправить; если passed — "none">
`;

function assertWorkflowId(id: string): string {
  const t = id.trim();
  if (!UUID_RE.test(t)) {
    throw new Error("Invalid workflow id");
  }
  return t;
}

async function ensureWorkflowsDir(): Promise<void> {
  await fs.mkdir(WORKFLOWS_DIR, { recursive: true });
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await ensureWorkflowsDir();
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, filePath);
}

function isWorkflowAgentKey(key: string): key is WorkflowAgentKey {
  return (
    key === "ceo" ||
    key === "operations" ||
    key === "funnel" ||
    key === "content_strategy" ||
    key === "rewriter" ||
    key === "tech_architect"
  );
}

function toWorkflowAgentKey(key: string): WorkflowAgentKey {
  if (!isWorkflowAgentKey(key)) {
    throw new Error(`Unsupported workflow agent key: ${key}`);
  }
  return key;
}

export function selectPrimaryAgent(userRequest: string): WorkflowAgentKey {
  const q = userRequest.toLowerCase();

  const tech =
    /сайт|код|cursor|баг|репозитор|github|git|css|frontend|backend|api|typescript|javascript|react|vite|deploy|инфраструктур|деплой|хостинг|docker|nginx|sql|база данных|endpoint|роут|middleware/i;
  if (tech.test(q)) return "tech_architect";

  const funnel =
    /оффер|продаж|воронк|заявк|лид|продукт|цен|подписк|оплат|конверс|cta|клиент/i;
  if (funnel.test(q)) return "funnel";

  const content =
    /контент|пост|карусел|reels|рилс|сторис|threads|telegram|тикток|tiktok|vk|ютуб|youtube|rubrics|рубрик|публикац/i;
  if (content.test(q)) return "content_strategy";

  const rewrite =
    /перепиши|текст|стиль|живее|рерайт|формулировк|заголовок|hook|хук/i;
  if (rewrite.test(q)) return "rewriter";

  return "operations";
}

export function selectReviewerForStep(
  stepAgentKey: WorkflowAgentKey
): WorkflowAgentKey {
  switch (stepAgentKey) {
    case "tech_architect":
      return "ceo";
    case "content_strategy":
      return "rewriter";
    case "rewriter":
      return "content_strategy";
    case "funnel":
      return "ceo";
    case "operations":
      return "ceo";
    case "ceo":
      return "operations";
    default:
      return "ceo";
  }
}

export function parseReviewStatus(text: string): ReviewStatus {
  if (/REVIEW_STATUS:\s*failed/i.test(text)) return "failed";
  if (/REVIEW_STATUS:\s*passed/i.test(text)) return "passed";
  return "failed";
}

function summarizeOutput(text: string | null, max = 400): string {
  if (!text) return "—";
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function buildSharedWorkflowContext(input: {
  workflow: AgentWorkflow;
  brainState: BrainState;
  brainLogEntries: BrainLogEntry[];
  agents: BrainAgent[];
}): string {
  const { workflow, brainState, brainLogEntries, agents } = input;
  const lines: string[] = [];

  lines.push("=== PROJECT STATE ===");
  lines.push(renderStateForAgent(brainState));

  lines.push("", "=== ORIGINAL USER REQUEST ===");
  lines.push(workflow.userRequest || "not set");

  lines.push("", "=== CEO PLAN ===");
  lines.push(workflow.ceoPlan?.trim() || "not set");

  lines.push("", "=== WORKFLOW STEPS ===");
  for (const s of workflow.steps) {
    lines.push(
      `- [${s.status}] ${s.agentKey} :: ${s.title} | review: ${s.reviewStatus}${
        s.reviewerKey ? ` (reviewer: ${s.reviewerKey})` : ""
      }`
    );
    if (s.output) lines.push(`  output: ${summarizeOutput(s.output)}`);
    if (s.reviewOutput)
      lines.push(`  review: ${summarizeOutput(s.reviewOutput, 300)}`);
  }

  lines.push("", "=== WORKFLOW MEMORY (recent) ===");
  const mem = workflow.memoryEvents.slice(-12);
  if (mem.length === 0) lines.push("(none)");
  else {
    for (const m of mem) {
      lines.push(`- [${m.type}] ${m.agentKey}: ${m.title}`);
      lines.push(`  ${summarizeOutput(m.body, 250)}`);
    }
  }

  lines.push("", "=== BRAIN LOG (latest) ===");
  const log = brainLogEntries.slice(-10);
  if (log.length === 0) lines.push("(none)");
  else {
    for (const e of log) {
      lines.push(
        `- [${e.entryType}] ${e.agentKey} ${e.ts}: ${e.title} — ${summarizeOutput(e.body, 200)}`
      );
    }
  }

  lines.push("", "=== AGENTS (keys / roles) ===");
  for (const a of agents) {
    lines.push(`- ${a.key}: ${a.role}`);
  }

  return lines.join("\n");
}

function workflowPath(id: string): string {
  return path.join(WORKFLOWS_DIR, `${assertWorkflowId(id)}.json`);
}

export async function saveWorkflow(workflow: AgentWorkflow): Promise<void> {
  workflow.updatedAt = new Date().toISOString();
  await writeJsonAtomic(workflowPath(workflow.id), workflow);
}

export async function readWorkflow(workflowId: string): Promise<AgentWorkflow> {
  try {
    const raw = await fs.readFile(workflowPath(workflowId), "utf-8");
    return JSON.parse(raw) as AgentWorkflow;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error("Workflow not found");
    }
    throw e;
  }
}

export async function listWorkflows(limit = 20): Promise<AgentWorkflow[]> {
  await ensureWorkflowsDir();
  let names: string[];
  try {
    names = await fs.readdir(WORKFLOWS_DIR);
  } catch {
    return [];
  }
  const jsonFiles = names.filter((n) => n.endsWith(".json") && UUID_RE.test(n.slice(0, -5)));
  const items: { mtime: number; wf: AgentWorkflow }[] = [];
  for (const f of jsonFiles) {
    const id = f.replace(/\.json$/i, "");
    if (!UUID_RE.test(id)) continue;
    try {
      const p = path.join(WORKFLOWS_DIR, f);
      const st = await fs.stat(p);
      const wf = await readWorkflow(id);
      items.push({ mtime: st.mtimeMs, wf });
    } catch {
      continue;
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return items.slice(0, limit).map((x) => x.wf);
}

export async function createWorkflowDraft(
  input: CreateWorkflowPlanInput
): Promise<AgentWorkflow> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    title: input.title.trim(),
    userRequest: input.userRequest.trim(),
    ceoPlan: null,
    sharedContextSnapshot: null,
    steps: [],
    memoryEvents: [],
    activityLog: [],
    currentActivity: null,
    finalResult: null,
    error: null,
  };
}

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  ceo: "CEO",
  operations: "Operations",
  funnel: "Funnel",
  content_strategy: "Контент",
  rewriter: "Rewriter",
  tech_architect: "Tech Arch",
  system: "Система",
};

function agentDisplayName(key: string): string {
  return AGENT_DISPLAY_NAMES[key] ?? key;
}

function newStep(
  agentKey: WorkflowAgentKey,
  reviewerKey: WorkflowAgentKey | null,
  title: string,
  instruction: string
): AgentWorkflowStep {
  return {
    id: crypto.randomUUID(),
    agentKey,
    reviewerKey,
    title,
    instruction,
    status: "pending",
    output: null,
    reviewStatus: "not_started",
    reviewOutput: null,
    revisionCount: 0,
    error: null,
    startedAt: null,
    completedAt: null,
  };
}

function pushMemory(
  workflow: AgentWorkflow,
  agentKey: WorkflowAgentKey,
  type: WorkflowMemoryEvent["type"],
  title: string,
  body: string
) {
  workflow.memoryEvents.push({
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    agentKey,
    type,
    title,
    body,
  });
}

function buildWorkflowSteps(userRequest: string): AgentWorkflowStep[] {
  const primary = selectPrimaryAgent(userRequest);

  switch (primary) {
    case "tech_architect":
      return [
        newStep(
          "ceo",
          "operations",
          "Уточнить цель и критерий готово",
          "Сформулируй цель задачи, критерии успеха, ограничения. Пиши для Егора — что нужно получить на выходе, по каким критериям оценить результат, что запрещено менять."
        ),
        newStep(
          "operations",
          "ceo",
          "Разбить задачу на конкретные шаги для Егора",
          "Составь список конкретных действий для Егора: что открыть, что найти, что изменить, что проверить. Только реальные действия — не упоминай агентов, системы, инструменты. Максимум 5 шагов в формате: СЕГОДНЯ / ПОРЯДОК / ЧТО НЕ ДЕЛАТЬ."
        ),
        newStep(
          "tech_architect",
          "ceo",
          "Техническая реализация и риски",
          "Укажи: owner-файл, что именно изменить (найти / заменить / удалить), как доказать через grep/diff, какие соседние файлы не трогать, какие риски."
        ),
        newStep(
          "ceo",
          null,
          "Финальный результат для Егора",
          "Собери финальный ответ: конкретное решение, порядок действий, что принято, что спорно, next action. Не скрывай конфликты между шагами."
        ),
      ];

    case "funnel":
      return [
        newStep(
          "ceo",
          "operations",
          "Уточнить цель и критерий готово",
          "Сформулируй цель задачи. Что конкретно нужно: оффер, лид-магнит, путь продажи? По каким критериям оценить результат?"
        ),
        newStep(
          "funnel",
          "ceo",
          "Воронка, оффер и путь к продаже",
          "Посмотри на задачу через продажи. Дай: конкретный оффер (формулировка выгоды), путь от внимания до заявки, CTA, лид-магнит если нужен. Никаких абстракций — только конкретные формулировки."
        ),
        newStep(
          "content_strategy",
          "rewriter",
          "Контентная подача",
          "Как это подать аудитории? Дай хук, структуру поста/карусели/сторис, платформу, формат. Один конкретный контент для этой задачи."
        ),
        newStep(
          "rewriter",
          "content_strategy",
          "Финальный текст в стиле Егора",
          "Перепиши ключевые формулировки. Живо, коротко, без GPT-тона. Дай 2-3 варианта хука."
        ),
        newStep(
          "ceo",
          null,
          "Финальный результат для Егора",
          "Собери финальный ответ: готовый оффер + текст + порядок действий + next action."
        ),
      ];

    case "content_strategy":
    case "rewriter":
      return [
        newStep(
          "ceo",
          "operations",
          "Уточнить цель и критерий готово",
          "Сформулируй цель задачи. Что конкретно нужно: пост, карусель, reels, сторис? Для какой платформы? Какой CTA? Какая аудитория?"
        ),
        newStep(
          "content_strategy",
          "rewriter",
          "Контентная подача",
          "Дай хук, структуру, формат. Для карусели — скелет слайдов. Для поста — структура. Для reels — сценарий 30-60 сек. Конкретно, без стратегических рассуждений."
        ),
        newStep(
          "rewriter",
          "content_strategy",
          "Финальный текст в стиле Егора",
          "Перепиши в живой стиль Егора. Убери GPT-тон, канцелярит. Дай финальный текст готовый к публикации."
        ),
        newStep(
          "ceo",
          null,
          "Финальный результат для Егора",
          "Выдай готовый контент + подпись + CTA + следующий шаг."
        ),
      ];

    default: // operations — ежедневные задачи, планирование, дисциплина
      return [
        newStep(
          "ceo",
          "operations",
          "Уточнить цель и критерий готово",
          "Сформулируй цель задачи, критерии успеха, ограничения."
        ),
        newStep(
          "operations",
          "ceo",
          "Разбить задачу на конкретные шаги для Егора",
          "Составь список конкретных действий для Егора. Только реальные действия — не упоминай агентов, инструменты или системы. Максимум 3-5 шагов в формате: СЕГОДНЯ / ПОРЯДОК / ЧТО НЕ ДЕЛАТЬ / ОТЧЁТ."
        ),
        newStep(
          "ceo",
          null,
          "Финальный результат для Егора",
          "Собери финальный ответ: решение, порядок действий, next action."
        ),
      ];
  }
}

export async function createWorkflowPlan(input: {
  title: string;
  userRequest: string;
  llm: WorkflowOpenRouter;
  ceoModel: string;
}): Promise<AgentWorkflow> {
  const title = input.title?.trim();
  const userRequest = input.userRequest?.trim();
  if (!title) throw new Error("title is required");
  if (!userRequest) throw new Error("userRequest is required");

  const brainState = await readBrainState();
  const brainLogEntries = await readBrainLog({ limit: 10 });
  const agents = await listAgents();
  const ceoAgent = await getAgentByKey("ceo");

  const draft = await createWorkflowDraft({ title, userRequest });

  const preContext = buildSharedWorkflowContext({
    workflow: {
      ...draft,
      ceoPlan: "(pending)",
      steps: [],
    },
    brainState,
    brainLogEntries,
    agents,
  });

  const ceoUser = `Заголовок задачи: ${title}

Запрос Егора:
${userRequest}

Сформируй чёткий план: цель, критерии готовности, риски, порядок шагов для команды агентов. Пиши по-русски.`;

  const ceoSystem =
    ceoAgent.systemPrompt +
    WORKFLOW_PROTOCOL +
    "\n\n--- SHARED CONTEXT ---\n" +
    preContext;

  const ceoPlan = await input.llm.complete({
    model: input.ceoModel,
    system: ceoSystem,
    user: ceoUser,
  });

  draft.ceoPlan = ceoPlan.trim();
  draft.sharedContextSnapshot = summarizeOutput(
    buildSharedWorkflowContext({
      workflow: { ...draft, steps: [] },
      brainState,
      brainLogEntries,
      agents,
    }),
    8000
  );

  draft.steps = buildWorkflowSteps(userRequest);

  draft.status = "planned";
  draft.memoryEvents = [];
  pushMemory(draft, "ceo", "plan", "CEO plan", draft.ceoPlan);

  await saveWorkflow(draft);
  return draft;
}

async function runAgentStep(args: {
  agent: BrainAgent;
  model: string;
  sharedContext: string;
  userBlock: string;
  llm: WorkflowOpenRouter;
}): Promise<string> {
  const system =
    args.agent.systemPrompt +
    WORKFLOW_PROTOCOL +
    "\n\n--- SHARED CONTEXT ---\n" +
    args.sharedContext;

  return args.llm.complete({
    model: args.model,
    system,
    user: args.userBlock,
  });
}

async function runReviewer(args: {
  reviewer: BrainAgent;
  model: string;
  sharedContext: string;
  outputToReview: string;
  llm: WorkflowOpenRouter;
}): Promise<string> {
  const system =
    args.reviewer.systemPrompt +
    REVIEW_PROTOCOL +
    "\n\n--- SHARED CONTEXT ---\n" +
    args.sharedContext;

  const user = `Проверь следующий output агента:\n\n---\n${args.outputToReview}\n---`;

  return args.llm.complete({
    model: args.model,
    system,
    user,
  });
}

export async function runWorkflow(input: {
  workflowId: string;
  llm: WorkflowOpenRouter;
}): Promise<AgentWorkflow> {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("Missing required env: OPENROUTER_API_KEY");
  }

  const workflow = await readWorkflow(input.workflowId);
  if (workflow.status === "completed") {
    throw new Error("Workflow already completed");
  }

  const brainState = await readBrainState();
  const brainLogEntries = await readBrainLog({ limit: 10 });
  const agents = await listAgents();

  workflow.activityLog = workflow.activityLog ?? [];
  workflow.currentActivity = null;
  workflow.status = "running";
  workflow.error = null;
  workflow.finalResult = null;
  for (const s of workflow.steps) {
    s.status = "pending";
    s.output = null;
    s.reviewOutput = null;
    s.reviewStatus = "not_started";
    s.revisionCount = 0;
    s.error = null;
    s.startedAt = null;
    s.completedAt = null;
  }
  await saveWorkflow(workflow);

  const pushAct = async (
    agentKey: string,
    phase: ActivityPhase,
    text: string
  ) => {
    workflow.activityLog.push({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      agentKey,
      phase,
      text,
    });
    await saveWorkflow(workflow);
  };

  await pushAct("system", "system", `▶ Запускаю цепочку: «${workflow.title}»`);

  const resolveModel = (agentKey: WorkflowAgentKey): string => {
    const a = agents.find((x) => x.key === agentKey);
    if (!a) throw new Error(`Unknown agent: ${agentKey}`);
    const m = process.env[a.modelEnv]?.trim();
    if (!m) throw new Error(`Missing required env: ${a.modelEnv}`);
    return m;
  };

  const llmWithModel = {
    complete: (args: { model: string; system: string; user: string }) =>
      input.llm.complete(args),
  };

  try {
    for (let stepIdx = 0; stepIdx < workflow.steps.length; stepIdx++) {
      const step = workflow.steps[stepIdx];
      const agentLabel = agentDisplayName(step.agentKey);

      step.status = "running";
      step.startedAt = new Date().toISOString();
      step.error = null;
      step.output = null;
      step.reviewStatus = "not_started";
      step.reviewOutput = null;
      step.revisionCount = 0;

      workflow.currentActivity = `${agentLabel} читает задачу…`;
      await saveWorkflow(workflow);

      await pushAct(
        step.agentKey,
        "reading",
        `${agentLabel} получает задачу [${stepIdx + 1}/${workflow.steps.length}]: «${step.title}»`
      );

      const agent = await getAgentByKey(step.agentKey);
      const model = resolveModel(step.agentKey);

      const runOneAgent = async (extra?: string) => {
        const shared = buildSharedWorkflowContext({
          workflow,
          brainState,
          brainLogEntries,
          agents,
        });
        const userBlock =
          `Шаг: ${step.title}\n\nИнструкция шага:\n${step.instruction}\n\n` +
          (extra ? `Дополнительно:\n${extra}\n\n` : "") +
          `Исходный запрос пользователя:\n${workflow.userRequest}`;

        workflow.currentActivity = `${agentLabel} думает и пишет ответ…`;
        await saveWorkflow(workflow);
        await pushAct(
          step.agentKey,
          "thinking",
          `${agentLabel} анализирует задачу и пишет ответ…`
        );

        return runAgentStep({
          agent,
          model,
          sharedContext: shared,
          userBlock,
          llm: llmWithModel,
        });
      };

      let output = await runOneAgent();

      step.output = output.trim();
      workflow.currentActivity = null;
      pushMemory(workflow, step.agentKey, "output", step.title, step.output);
      await pushAct(step.agentKey, "output", step.output);

      const runReview = async (candidateOutput: string) => {
        if (!step.reviewerKey) return "passed" as ReviewStatus;

        const reviewerLabel = agentDisplayName(step.reviewerKey);

        step.status = "reviewing";
        await pushAct(
          step.agentKey,
          "sending",
          `${agentLabel} → ${reviewerLabel}: отправляю работу на проверку`
        );

        workflow.currentActivity = `${reviewerLabel} читает работу ${agentLabel}…`;
        await saveWorkflow(workflow);
        await pushAct(
          step.reviewerKey,
          "reading",
          `${reviewerLabel} читает результат от ${agentLabel}…`
        );

        const reviewer = await getAgentByKey(step.reviewerKey);
        const revModel = resolveModel(step.reviewerKey);
        const shared = buildSharedWorkflowContext({
          workflow,
          brainState,
          brainLogEntries,
          agents,
        });

        workflow.currentActivity = `${reviewerLabel} оценивает качество работы…`;
        await saveWorkflow(workflow);
        await pushAct(
          step.reviewerKey,
          "thinking",
          `${reviewerLabel} проверяет качество работы ${agentLabel}…`
        );

        const reviewText = await runReviewer({
          reviewer,
          model: revModel,
          sharedContext: shared,
          outputToReview: candidateOutput,
          llm: llmWithModel,
        });

        step.reviewOutput = reviewText.trim();
        const rs = parseReviewStatus(reviewText);
        step.reviewStatus = rs;
        workflow.currentActivity = null;

        pushMemory(
          workflow,
          step.reviewerKey,
          "review",
          `Review for step ${step.title}`,
          step.reviewOutput
        );

        const verdict = rs === "passed" ? "✅ Принято" : "❌ Нужно переделать";
        await pushAct(
          step.reviewerKey,
          "review",
          `${step.reviewOutput}\n\n────\n${verdict}`
        );

        return rs;
      };

      let reviewResult: ReviewStatus = "passed";
      if (step.reviewerKey) {
        reviewResult = await runReview(step.output);
      } else {
        step.reviewStatus = "not_started";
      }

      if (step.reviewerKey && reviewResult === "failed") {
        step.status = "revision_required";

        if (step.revisionCount < 1) {
          step.revisionCount += 1;
          const reviewOut = step.reviewOutput ?? "";
          const fix =
            reviewOut.match(/REQUIRED_FIX:\s*([\s\S]*)/i)?.[1]?.trim() ||
            "Усиль результат по замечаниям ревьюера.";
          pushMemory(workflow, step.agentKey, "revision", "Revision requested", fix);

          await pushAct(
            step.agentKey,
            "revision",
            `${agentLabel} получил замечания и переделывает…\n\nЧто исправить:\n${fix}`
          );

          workflow.currentActivity = `${agentLabel} исправляет работу…`;
          await saveWorkflow(workflow);
          await pushAct(
            step.agentKey,
            "thinking",
            `${agentLabel} переписывает с учётом замечаний…`
          );

          output = await runOneAgent(
            `Ревью не прошло. Исправь и улучши output. Замечания:\n${reviewOut}\n\nТребуемое исправление:\n${fix}`
          );
          step.output = output.trim();
          workflow.currentActivity = null;
          pushMemory(
            workflow,
            step.agentKey,
            "output",
            `${step.title} (revision)`,
            step.output
          );
          await pushAct(step.agentKey, "output", step.output);

          const second = await runReview(step.output);
          if (second === "failed") {
            workflow.status = "failed";
            workflow.error = step.reviewOutput || "Review failed after revision";
            workflow.currentActivity = null;
            await pushAct("system", "error", `❌ Цепочка остановлена: ревью не прошло дважды`);
            await saveWorkflow(workflow);
            return workflow;
          }
        } else {
          workflow.status = "failed";
          workflow.error = step.reviewOutput || "Review failed";
          workflow.currentActivity = null;
          await pushAct("system", "error", `❌ Цепочка остановлена: ревью провалено`);
          await saveWorkflow(workflow);
          return workflow;
        }
      }

      step.status = "completed";
      step.completedAt = new Date().toISOString();
      await pushAct(
        step.agentKey,
        "done",
        `✓ ${agentLabel} завершил шаг «${step.title}»`
      );
    }

    const lastCeoStep = [...workflow.steps]
      .reverse()
      .find((s) => s.agentKey === "ceo");
    workflow.finalResult =
      lastCeoStep?.output?.trim() ||
      workflow.steps[workflow.steps.length - 1]?.output?.trim() ||
      null;
    workflow.status = "completed";
    workflow.currentActivity = null;
    if (workflow.finalResult) {
      pushMemory(workflow, "ceo", "final", "Final result", workflow.finalResult);
    }
    await pushAct("system", "done", `✅ Цепочка завершена! Финальный результат собран.`);

    return workflow;
  } catch (e) {
    workflow.status = "failed";
    workflow.error = e instanceof Error ? e.message : String(e);
    workflow.currentActivity = null;
    await pushAct("system", "error", `❌ Ошибка: ${workflow.error}`);
    throw e;
  }
}

export function startWorkflowBackground(input: {
  workflowId: string;
  llm: WorkflowOpenRouter;
}): void {
  void runWorkflow({ workflowId: input.workflowId, llm: input.llm }).catch(
    (e: unknown) => {
      console.error("[workflow-bg] unhandled error:", e instanceof Error ? e.message : e);
    }
  );
}
