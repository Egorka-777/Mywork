import { boolean, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const publishLogs = pgTable("publish_logs", {
  id: serial("id").primaryKey(),
  draftId: text("draft_id").notNull(),
  ok: boolean("ok").notNull(),
  message: text("message"),
  raw: jsonb("raw").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});
