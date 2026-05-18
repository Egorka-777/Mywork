import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = path.resolve(__dirname, "..", "data", "brain");
const AGENTS_PATH = path.join(BRAIN_DIR, "agents.json");
const STATE_PATH = path.join(BRAIN_DIR, "state.json");
const LOG_PATH = path.join(BRAIN_DIR, "log.jsonl");
const CONVERSATIONS_DIR = path.join(BRAIN_DIR, "conversations");

const LOG_ENTRY_TYPES = [
  "decision",
  "insight",
  "worked",
  "not_worked",
  "task",
  "note",
] as const;

const MESSAGE_ROLES = ["user", "assistant"] as const;

export type BrainAgent = {
  key: string;
  name: string;
  role: string;
  modelEnv: string;
  systemPrompt: string;
};

export type BrainAgentsFile = {
  version: number;
  agents: BrainAgent[];
};

export type BrainState = Record<string, unknown>;

export type BrainLogEntryType =
  | "decision"
  | "insight"
  | "worked"
  | "not_worked"
  | "task"
  | "note";

export type BrainLogEntry = {
  id: string;
  ts: string;
  agentKey: string;
  entryType: BrainLogEntryType;
  title: string;
  body: string;
  tags: string[];
};

export type BrainLogEntryInput = {
  agentKey: string;
  entryType: BrainLogEntryType;
  title: string;
  body: string;
  tags?: string[];
};

export type BrainMessage = {
  id: string;
  ts: string;
  role: "user" | "assistant";
  content: string;
};

type ReadJsonlOptions = {
  limit?: number;
};

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function validateEntryType(entryType: string): BrainLogEntryType {
  if (!(LOG_ENTRY_TYPES as readonly string[]).includes(entryType)) {
    throw new Error(
      `Invalid entryType: ${entryType}. Expected one of: ${LOG_ENTRY_TYPES.join(", ")}`
    );
  }
  return entryType as BrainLogEntryType;
}

async function ensureBrainDirs(): Promise<void> {
  await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await ensureBrainDirs();
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, filePath);
}

async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw e;
  }

  const items: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed) as T);
    } catch {
      continue;
    }
  }
  return items;
}

function takeLast<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return items.slice(items.length - limit);
}

async function appendJsonlLine(filePath: string, value: unknown): Promise<void> {
  await ensureBrainDirs();
  const line = JSON.stringify(value) + "\n";
  await fs.appendFile(filePath, line, "utf-8");
}

function conversationPathForAgent(agentKey: string): string {
  return path.join(CONVERSATIONS_DIR, `${agentKey}.jsonl`);
}

export async function readBrainState(): Promise<BrainState> {
  return readJsonFile<BrainState>(STATE_PATH);
}

export async function patchBrainState(
  patch: Record<string, unknown>
): Promise<BrainState> {
  const currentState = await readBrainState();
  const nextState: BrainState = {
    ...currentState,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(STATE_PATH, nextState);
  return nextState;
}

export async function readBrainLog(
  options?: ReadJsonlOptions
): Promise<BrainLogEntry[]> {
  const limit = options?.limit ?? 100;
  const entries = await readJsonlFile<BrainLogEntry>(LOG_PATH);
  return takeLast(entries, limit);
}

export async function appendBrainLog(
  input: BrainLogEntryInput
): Promise<BrainLogEntry> {
  await getAgentByKey(input.agentKey);
  const entryType = validateEntryType(input.entryType);
  const title = assertNonEmptyString(input.title, "title");
  const body = assertNonEmptyString(input.body, "body");
  const tags = input.tags ?? [];

  const entry: BrainLogEntry = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    agentKey: input.agentKey,
    entryType,
    title,
    body,
    tags,
  };

  await appendJsonlLine(LOG_PATH, entry);
  return entry;
}

export async function listAgents(): Promise<BrainAgent[]> {
  const data = await readJsonFile<BrainAgentsFile>(AGENTS_PATH);
  if (!Array.isArray(data.agents)) {
    throw new Error("agents.json: agents must be an array");
  }
  return data.agents;
}

export async function getAgentByKey(agentKey: string): Promise<BrainAgent> {
  const key = assertNonEmptyString(agentKey, "agentKey");
  if (key.includes("..") || key.includes("/") || key.includes("\\")) {
    throw new Error(`Invalid agent key: ${agentKey}`);
  }

  const agents = await listAgents();
  const agent = agents.find((a) => a.key === key);
  if (!agent) {
    throw new Error(`Unknown agent key: ${agentKey}`);
  }
  return agent;
}

export async function listAgentMessages(
  agentKey: string,
  options?: ReadJsonlOptions
): Promise<BrainMessage[]> {
  const agent = await getAgentByKey(agentKey);
  const limit = options?.limit ?? 50;
  const filePath = conversationPathForAgent(agent.key);
  const messages = await readJsonlFile<BrainMessage>(filePath);
  return takeLast(messages, limit);
}

export async function appendAgentMessage(
  agentKey: string,
  message: Pick<BrainMessage, "role" | "content">
): Promise<BrainMessage> {
  const agent = await getAgentByKey(agentKey);
  if (!(MESSAGE_ROLES as readonly string[]).includes(message.role)) {
    throw new Error('role must be "user" or "assistant"');
  }
  const content = assertNonEmptyString(message.content, "content");

  const record: BrainMessage = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    role: message.role,
    content,
  };

  const filePath = conversationPathForAgent(agent.key);
  await appendJsonlLine(filePath, record);
  return record;
}

function readNestedTitle(state: BrainState, key: string): string {
  const block = state[key];
  if (!block || typeof block !== "object") return "not set";
  const title = (block as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title : "not set";
}

export function renderStateForAgent(state: BrainState): string {
  const lines: string[] = [
    `Goal (year): ${readNestedTitle(state, "goalYear")}`,
    `Focus (quarter): ${readNestedTitle(state, "focusQuarter")}`,
    `Focus (week): ${readNestedTitle(state, "focusWeek")}`,
    "",
    "Daily tasks:",
  ];

  const dailyTasks = state.dailyTasks;
  if (Array.isArray(dailyTasks) && dailyTasks.length > 0) {
    for (const task of dailyTasks) {
      if (!task || typeof task !== "object") continue;
      const t = task as Record<string, unknown>;
      const id = typeof t.id === "string" ? t.id : "?";
      const title = typeof t.title === "string" ? t.title : "not set";
      const status = typeof t.status === "string" ? t.status : "unknown";
      lines.push(`- [${status}] ${id}: ${title}`);
    }
  } else {
    lines.push("- none");
  }

  lines.push("", "Do not touch:");
  const frozen = state.frozen;
  if (
    frozen &&
    typeof frozen === "object" &&
    Array.isArray((frozen as Record<string, unknown>).doNotTouch)
  ) {
    const notes = (frozen as { doNotTouch: unknown[] }).doNotTouch;
    if (notes.length === 0) {
      lines.push("- none");
    } else {
      for (const note of notes) {
        lines.push(`- ${typeof note === "string" ? note : String(note)}`);
      }
    }
  } else {
    lines.push("- not set");
  }

  return lines.join("\n");
}
