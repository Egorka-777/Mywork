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

const WORKFLOW_PROTOCOL = `

WORKFLOW PROTOCOL:
Ты участвуешь в общей задаче. Ты видишь shared context: исходный запрос, план CEO, предыдущие outputs, review notes и brain log.
Не игнорируй предыдущие шаги.
Не повторяй то, что уже сделал другой агент.
Делай только свою роль.
В конце ответа обязательно добавь:
HANDOFF_SUMMARY:
- что сделано
- что следующему агенту нужно знать
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
    finalResult: null,
    error: null,
  };
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

  const primary = selectPrimaryAgent(userRequest);
  const reviewerPrimary = selectReviewerForStep(primary);

  draft.steps = [
    newStep(
      "ceo",
      "operations",
      "Уточнить цель и критерий готово",
      "Сформулируй цель, критерии успеха и границы задачи. Учти план выше и shared context."
    ),
    newStep(
      "operations",
      "ceo",
      "Разбить задачу на исполнимые шаги",
      "Преврати запрос в конкретный порядок действий и чеклист без воды."
    ),
    newStep(
      primary,
      reviewerPrimary,
      "Выполнить профильную часть задачи",
      `Сделай основную работу по запросу. Профиль: ${primary}. Опирайся на план CEO и предыдущие шаги.`
    ),
    newStep(
      "ceo",
      null,
      "Собрать финальный результат для Егора",
      "Собери итог: что сделано, что принято, что записать в brain log, next action. Кратко и по делу."
    ),
  ];

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
    for (const step of workflow.steps) {
      step.status = "running";
      step.startedAt = new Date().toISOString();
      step.error = null;
      step.output = null;
      step.reviewStatus = "not_started";
      step.reviewOutput = null;
      step.revisionCount = 0;
      await saveWorkflow(workflow);

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

        return runAgentStep({
          agent,
          model,
          sharedContext: shared,
          userBlock,
          llm: llmWithModel,
        });
      };

      let output = await runOneAgent();

      const runReview = async (candidateOutput: string) => {
        if (!step.reviewerKey) return "passed" as ReviewStatus;

        step.status = "reviewing";
        await saveWorkflow(workflow);

        const reviewer = await getAgentByKey(step.reviewerKey);
        const revModel = resolveModel(step.reviewerKey);
        const shared = buildSharedWorkflowContext({
          workflow,
          brainState,
          brainLogEntries,
          agents,
        });

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
        pushMemory(
          workflow,
          step.reviewerKey,
          "review",
          `Review for step ${step.title}`,
          step.reviewOutput
        );
        await saveWorkflow(workflow);
        return rs;
      };

      step.output = output.trim();
      pushMemory(
        workflow,
        step.agentKey,
        "output",
        step.title,
        step.output
      );
      await saveWorkflow(workflow);

      let reviewResult: ReviewStatus = "passed";
      if (step.reviewerKey) {
        reviewResult = await runReview(step.output);
      } else {
        step.reviewStatus = "not_started";
      }

      if (step.reviewerKey && reviewResult === "failed") {
        step.status = "revision_required";
        await saveWorkflow(workflow);

        if (step.revisionCount < 1) {
          step.revisionCount += 1;
          const reviewOut = step.reviewOutput ?? "";
          const fix =
            reviewOut.match(/REQUIRED_FIX:\s*([\s\S]*)/i)?.[1]?.trim() ||
            "Усиль результат по замечаниям ревьюера.";
          pushMemory(
            workflow,
            step.agentKey,
            "revision",
            "Revision requested",
            fix
          );
          output = await runOneAgent(
            `Ревью не прошло. Исправь и улучши output. Замечания:\n${reviewOut}\n\nТребуемое исправление:\n${fix}`
          );
          step.output = output.trim();
          pushMemory(
            workflow,
            step.agentKey,
            "output",
            `${step.title} (revision)`,
            step.output
          );
          await saveWorkflow(workflow);

          const second = await runReview(step.output);
          if (second === "failed") {
            workflow.status = "failed";
            workflow.error =
              step.reviewOutput || "Review failed after revision";
            await saveWorkflow(workflow);
            return workflow;
          }
        } else {
          workflow.status = "failed";
          workflow.error = step.reviewOutput || "Review failed";
          await saveWorkflow(workflow);
          return workflow;
        }
      }

      step.status = "completed";
      step.completedAt = new Date().toISOString();
      await saveWorkflow(workflow);
    }

    const lastCeoStep = [...workflow.steps]
      .reverse()
      .find((s) => s.agentKey === "ceo");
    workflow.finalResult =
      lastCeoStep?.output?.trim() ||
      workflow.steps[workflow.steps.length - 1]?.output?.trim() ||
      null;
    workflow.status = "completed";
    if (workflow.finalResult) {
      pushMemory(
        workflow,
        "ceo",
        "final",
        "Final result",
        workflow.finalResult
      );
    }
    await saveWorkflow(workflow);
    return workflow;
  } catch (e) {
    workflow.status = "failed";
    workflow.error = e instanceof Error ? e.message : String(e);
    await saveWorkflow(workflow);
    throw e;
  }
}
