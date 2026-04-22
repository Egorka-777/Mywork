import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const referenceImages = pgTable("reference_images", {
  id: serial("id").primaryKey(),
  /** Public HTTPS URL to JPEG/PNG for SeedDream (and Threads upload). */
  url: text("url").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isPrimary: boolean("is_primary").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});
