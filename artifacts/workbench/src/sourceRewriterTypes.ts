export type SourceFileType =
  | "video"
  | "audio"
  | "pdf"
  | "presentation"
  | "image"
  | "text"
  | "docx"
  | "unknown";

export type ExtractedVisualDescription = {
  id: string;
  sourcePage?: number;
  sourceSlide?: number;
  sourceTimestamp?: string;
  type: "photo" | "screenshot" | "chart" | "graphic" | "ui" | "unknown";
  visibleText: string;
  visualDescription: string;
  styleDescription: string;
  clothing: string;
  accessoriesAndProps: string;
  lighting: string;
  background: string;
  composition: string;
  colors: string[];
  recreationNotes: string[];
};

export type ExtractedPage = {
  pageNumber: number;
  rawText: string;
  visualAssets: ExtractedVisualDescription[];
};

export type ExtractedSlide = {
  slideNumber: number;
  title?: string;
  rawText: string;
  layoutNotes: string;
  visualAssets: ExtractedVisualDescription[];
};

export type ExtractedSource = {
  id: string;
  fileName: string;
  fileType: SourceFileType;
  fullRawText: string;
  transcript?: string;
  pages?: ExtractedPage[];
  slides?: ExtractedSlide[];
  visualAssets: ExtractedVisualDescription[];
  extractionWarnings: string[];
};

export type RewriteMode =
  | "preserve_original_structure"
  | "storytelling_text"
  | "presentation_text"
  | "carousel_script"
  | "lesson_material"
  | "clean_article"
  | "sales_page_text"
  | "telegram_post"
  | "instagram_post";

export type OutputLength =
  | "keep_similar_length"
  | "shorter"
  | "longer"
  | "very_concise"
  | "expanded";

export type StyleIntensity =
  | "light_rewrite"
  | "normal_rewrite"
  | "strong_rewrite";

export type PlagiarismSafety =
  | "light_uniqueness"
  | "strong_uniqueness"
  | "maximum_uniqueness_without_losing_meaning";

export type RewriteSettings = {
  rewriteMode: RewriteMode;
  outputLength: OutputLength;
  styleIntensity: StyleIntensity;
  plagiarismSafety: PlagiarismSafety;
};

export type RewrittenSource = {
  id: string;
  fileName: string;
  fileType: SourceFileType;
  rewriteMode: RewriteMode;
  fullRewrittenText: string;
  rewrittenPages?: {
    pageNumber: number;
    rewrittenText: string;
    visualAssets: ExtractedVisualDescription[];
  }[];
  rewrittenSlides?: {
    slideNumber: number;
    rewrittenText: string;
    visualAssets: ExtractedVisualDescription[];
    layoutNotes: string;
  }[];
  rewrittenTranscript?: string;
  notes: string[];
};
