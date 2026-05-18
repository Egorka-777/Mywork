import type {
  AgentMessagesResponse,
  AgentSummary,
  AgentsResponse,
  BrainApiErrorPayload,
  BrainLogEntry,
  BrainLogEntryInput,
  BrainLogResponse,
  BrainMessage,
  BrainState,
  BrainStatePatch,
  SendAgentMessageResponse,
} from "./brainTypes";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function buildQuery(
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed with status ${response.status}`;

  try {
    const payload = (await response.json()) as BrainApiErrorPayload;

    if (payload.error && payload.detail) {
      return `${payload.error}: ${payload.detail}`;
    }

    if (payload.error) {
      return payload.error;
    }

    if (payload.detail) {
      return payload.detail;
    }
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) {
        return text.trim();
      }
    } catch {
      return fallback;
    }
  }

  return fallback;
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as T;
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  return value.trim();
}

export async function fetchBrainState(): Promise<BrainState> {
  return requestJson<BrainState>("/wb/brain/state");
}

export async function patchBrainState(
  patch: BrainStatePatch
): Promise<BrainState> {
  return requestJson<BrainState>("/wb/brain/state", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

export async function fetchBrainLog(limit = 100): Promise<BrainLogEntry[]> {
  const response = await requestJson<BrainLogResponse>(
    `/wb/brain/log${buildQuery({ limit })}`
  );

  return response.entries;
}

export async function saveBrainLogEntry(
  input: BrainLogEntryInput
): Promise<BrainLogEntry> {
  const response = await requestJson<{ entry: BrainLogEntry }>("/wb/brain/log", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });

  return response.entry;
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const response = await requestJson<AgentsResponse>("/wb/agents");
  return response.agents;
}

export async function fetchAgentMessages(
  agentKey: string,
  limit = 50
): Promise<BrainMessage[]> {
  const safeAgentKey = encodeURIComponent(
    assertNonEmptyString(agentKey, "agentKey")
  );
  const response = await requestJson<AgentMessagesResponse>(
    `/wb/agents/${safeAgentKey}/messages${buildQuery({ limit })}`
  );

  return response.messages;
}

export async function sendAgentMessage(
  agentKey: string,
  content: string
): Promise<BrainMessage> {
  const safeAgentKey = encodeURIComponent(
    assertNonEmptyString(agentKey, "agentKey")
  );
  const safeContent = assertNonEmptyString(content, "content");

  const response = await requestJson<SendAgentMessageResponse>(
    `/wb/agents/${safeAgentKey}/messages`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: safeContent }),
    }
  );

  return response.message;
}
