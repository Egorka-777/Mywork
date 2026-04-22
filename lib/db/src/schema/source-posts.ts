import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Fetched & cached public posts from Threads (or fallback).
 * id = Threads / external post id.
 */
export const sourcePosts = pgTable(
  "source_posts",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull(),
    text: text("text").notNull(),
    username: text("username"),
    permalink: text("permalink"),
    likeCount: integer("like_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    repostCount: integer("repost_count").notNull().default(0),
    quoteCount: integer("quote_count").notNull().default(0),
    /** ISO-8601 from API, if any. */
    postedAt: text("posted_at"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("source_posts_source_key_idx").on(t.sourceKey)],
);
