export type LipsyncJobStatus =
  | "draft"
  | "ready_for_render"
  | "provider_not_configured"
  | "rendering"
  | "succeeded"
  | "failed";

export type LipsyncVideoFormat = "vertical_9_16" | "square_1_1" | "portrait_4_5";

export type LipsyncJob = {
  id: string;
  title: string;
  script: string;
  faceAssetId: string | null;
  faceAssetName: string | null;
  provider: "fal.ai";
  modelId: string | null;
  videoFormat: LipsyncVideoFormat;
  status: LipsyncJobStatus;
  resultUrl: string | null;
  error: string | null;
  source: "manual" | "source_rewriter";
  sourceTitle: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LipsyncJobsResponse = {
  jobs: LipsyncJob[];
};

export type LipsyncJobResponse = {
  job: LipsyncJob;
};

export type CreateLipsyncJobInput = {
  title: string;
  script: string;
  faceAssetId: string | null;
  videoFormat: LipsyncVideoFormat;
  source: "manual" | "source_rewriter";
  sourceTitle?: string | null;
};
