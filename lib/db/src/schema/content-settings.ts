import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const contentSettings = pgTable("content_settings", {
  id: serial("id").primaryKey(),
  brandPrompt: text("brand_prompt").notNull().default(""),
  hardRules: text("hard_rules").notNull().default(""),
  autoPublish: boolean("auto_publish").notNull().default(false),
  lookbackDays: integer("lookback_days").notNull().default(14),
  minPostChars: integer("min_post_chars").notNull().default(80),
  /** Max initial posts to pull per source before scoring (e.g. 20). */
  maxPostsPerSource: integer("max_posts_per_source").notNull().default(20),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});
