import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const contentSources = pgTable("content_sources", {
  id: serial("id").primaryKey(),
  /** "competitor" | "keyword" */
  mode: text("mode").notNull(),
  /** @handle (without @) or keyword string */
  value: text("value").notNull(),
  /** For keyword search: limit to this author, if set */
  authorUsername: text("author_username"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});
