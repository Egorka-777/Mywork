export type LipsyncJobStatus =
  | "draft"
  | "ready_for_render"
  | "provider_not_configured"
  | "rendering"
  | "succeeded"
  | "failed";

export type LipsyncVideoFormat = "vertical_9_16" | "square_1_1" | "portrait_4_5";
export type LipsyncResolution = "480p" | "720p";

export type LipsyncJob = {
  id: string;
  title: string;
  script: string;
  faceAssetId: string | null;
  faceAssetName: string | null;
  faceFalUrl: string | null;
  audioUrl: string | null;
  audioFileName: string | null;
  provider: "fal.ai";
  modelId: "creatify_aurora";
  videoFormat: LipsyncVideoFormat;
  resolution: LipsyncResolution;
  status: LipsyncJobStatus;
  requestId: string | null;
  statusUrl: string | null;
  responseUrl: string | null;
  resultUrl: string | null;
  error: string | null;
  source: "manual" | "source_rewriter";
  sourceTitle: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LipsyncJobsResponse = { jobs: LipsyncJob[] };
export type LipsyncJobResponse = { job: LipsyncJob };
export type LipsyncAudioUploadResponse = { url: string; fileName: string };

export type CreateLipsyncJobInput = {
  title: string;
  script: string;
  faceAssetId: string | null;
  audioUrl: string | null;
  audioFileName: string | null;
  videoFormat: LipsyncVideoFormat;
  resolution: LipsyncResolution;
  source: "manual" | "source_rewriter";
  sourceTitle?: string | null;
};
