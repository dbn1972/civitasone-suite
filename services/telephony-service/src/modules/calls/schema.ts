/**
 * calls module — Drizzle schema in Postgres schema `telephony`.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("telephony");

export const calls = domainSchema.table("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  callerNumber: varchar("caller_number", { length: 32 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type CallRow = typeof calls.$inferSelect;
export type CallInsert = typeof calls.$inferInsert;

export type CallView = {
  id: string;
  tenantId: string;
  name: string;
  callerNumber: string | null;
  status: string;
  version: number;
};

export const schema = { calls };
