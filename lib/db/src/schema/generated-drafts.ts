import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const generatedDrafts = pgTable(
  "generated_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourcePostId: text("source_post_id").notNull(),
    sourceText: text("source_text").notNull(),
    rewrittenText: text("rewritten_text").notNull(),
    hook: text("hook"),
    body: text("body"),
    imagePrompt: text("image_prompt").notNull().default(""),
    imageIdea: text("image_idea"),
    imageUrl: text("image_url"),
    /** draft | ready_to_publish | published | error */
    status: text("status").notNull().default("draft"),
    /** Raw JSON from LLM. */
    rewriteJson: jsonb("rewrite_json").$type<Record<string, unknown>>(),
    publishedThreadsPostId: text("published_threads_post_id"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [index("generated_drafts_source_post_id_idx").on(t.sourcePostId)],
);
