export type ReplyMode = "off" | "draft" | "auto";
export type AutoEnvironment = "test" | "live";
export type TaskRadarItemStatus = "new" | "opened" | "replied" | "ignored";
export type TaskRadarSource = "telegram" | "web";

export type TaskRadarSettings = {
  keywords: string[];
  excludeKeywords: string[];
  maxAgeMinutes: number;
  telegramEnabled: boolean;
  webEnabled: boolean;
  replyMode: ReplyMode;
  replyTemplate: string;
  autoEnvironment: AutoEnvironment;
  maxAutoPerHour: number;
  maxAutoPerDay: number;
  webDomains: string[];
  autoLiveConfirmed: boolean;
  autoDisabledReason: string | null;
};

export type TaskRadarItem = {
  id: string;
  source: TaskRadarSource;
  externalId: string | null;
  fingerprint: string;
  text: string;
  title?: string | null;
  publishedAt: string | null;
  foundAt: string;
  dateUnknown: boolean;
  chatId?: string | null;
  sourceTitle: string | null;
  sourceUsername: string | null;
  senderId?: string | null;
  senderUsername?: string | null;
  url: string | null;
  matchedKeyword: string;
  status: TaskRadarItemStatus;
  domain?: string | null;
  repliedAt?: string | null;
};

export type TaskRadarHealth = {
  ok: boolean;
  telegram: {
    connected: boolean;
    accountId: string | null;
    username: string | null;
    error: string | null;
  };
  apify: {
    tokenConfigured: boolean;
    actorConfigured: boolean;
    webActorConfigured: boolean;
    suitableForWebSearch: boolean;
    reason: string;
    actorName: string | null;
  };
  replyMode: ReplyMode;
  autoEnvironment: AutoEnvironment;
  autoDisabledReason: string | null;
  resultsCount: number;
  newCount: number;
  lastRun: {
    at?: string;
    stats?: Record<string, number>;
  } | null;
};

export type TaskRadarSearchResult = {
  ok: boolean;
  items: TaskRadarItem[];
  stats: {
    keywordsChecked: number;
    rawFound: number;
    kept: number;
    duplicates: number;
    excluded: number;
    telegramKept: number;
    webKept: number;
  };
  warnings: string[];
  telegramError?: string;
  webError?: string;
};
