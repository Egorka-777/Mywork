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

export type WorkflowResponse = {
  workflow: AgentWorkflow;
};

export type WorkflowsResponse = {
  workflows: AgentWorkflow[];
};
