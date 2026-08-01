import { uuid, varchar, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { helpdeskSchema } from "../tickets/schema.js";

export const dispositions = helpdeskSchema.table("dispositions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: varchar("label", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type DispositionRow = typeof dispositions.$inferSelect;
export type DispositionInsert = typeof dispositions.$inferInsert;
