export type InstagramCompetitor = {
  id: string;
  url: string;
  username: string;
  label: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InstagramRadarPostType = "carousel" | "reel" | "image" | "video" | "unknown";

export type InstagramRadarPost = {
  id: string;
  competitorId: string;
  competitorUsername: string;
  url: string;
  shortcode: string | null;
  caption: string;
  postType: InstagramRadarPostType;
  timestamp: string | null;
  likesCount: number | null;
  commentsCount: number | null;
  videoViewCount: number | null;
  playCount: number | null;
  imageUrls: string[];
  thumbnailUrl: string | null;
  score: number;
  scoreReason: string;
  fetchedAt: string;
};

export type InstagramRadarSyncResult = {
  ok: boolean;
  windowDays: number;
  competitorsChecked: number;
  postsFound: number;
  postsKept: number;
  posts: InstagramRadarPost[];
};

export type InstagramRadarListResponse = {
  competitors: InstagramCompetitor[];
};

export type InstagramRadarPostsResponse = {
  posts: InstagramRadarPost[];
};
