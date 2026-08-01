import { uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { helpdeskSchema } from "../tickets/schema.js";

export const statusConfig = helpdeskSchema.table("status_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 64 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(),
  canonicalState: varchar("canonical_state", { length: 24 }).notNull(),
  ordinal: integer("ordinal").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type StatusConfigRow = typeof statusConfig.$inferSelect;
export type StatusConfigInsert = typeof statusConfig.$inferInsert;
