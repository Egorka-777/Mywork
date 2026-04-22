export type CandidatePost = {
  id: string;
  text: string;
  permalink?: string;
  username?: string;
  like_count?: number;
  reply_count?: number;
  repost_count?: number;
  quote_count?: number;
  timestamp?: string;
};

export function scorePost(post: CandidatePost) {
  const likes = post.like_count ?? 0;
  const replies = post.reply_count ?? 0;
  const reposts = post.repost_count ?? 0;
  const quotes = post.quote_count ?? 0;

  const ageHours = post.timestamp
    ? (Date.now() - new Date(post.timestamp).getTime()) / 36e5
    : 0;

  return likes + replies * 2 + reposts * 2 + quotes * 1.5 - ageHours * 0.15;
}

function percentileN(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(
    s.length - 1,
    Math.max(0, Math.ceil(p * s.length) - 1),
  );
  return s[i] ?? 0;
}

/** p75 of scores within a batch (e.g. one competitor’s top-20). */
export function scorePercentile75(scores: number[]) {
  return percentileN(scores, 0.75);
}
