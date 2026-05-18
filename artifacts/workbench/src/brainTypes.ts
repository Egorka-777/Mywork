export type AgentSummary = {
  key: string;
  name: string;
  role: string;
};

export type DailyTaskStatus = "todo" | "doing" | "done";

export type DailyTaskSource = "manual" | "agent";

export type DailyTask = {
  id: string;
  title: string;
  status: DailyTaskStatus;
  source: DailyTaskSource;
};

export type BrainFocusBlock = {
  title: string;
  description: string;
  status: string;
};

export type BrainState = {
  version: number;
  updatedAt: string | null;
  goalYear: BrainFocusBlock;
  focusQuarter: BrainFocusBlock;
  focusWeek: BrainFocusBlock;
  activeProducts?: unknown[];
  activeFunnel?: {
    status?: string;
    notes?: unknown[];
  };
  dailyTasks: DailyTask[];
  frozen?: {
    doNotTouch?: string[];
  };
};

export type BrainMessageRole = "user" | "assistant";

export type BrainMessage = {
  id: string;
  ts: string;
  role: BrainMessageRole;
  content: string;
};

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

export type BrainStatePatch = Partial<BrainState>;

export type AgentsResponse = {
  agents: AgentSummary[];
};

export type BrainLogResponse = {
  entries: BrainLogEntry[];
};

export type AgentMessagesResponse = {
  messages: BrainMessage[];
};

export type SendAgentMessageResponse = {
  message: BrainMessage;
  userMessage?: BrainMessage;
};

export type BrainApiErrorPayload = {
  error?: string;
  detail?: string;
};
