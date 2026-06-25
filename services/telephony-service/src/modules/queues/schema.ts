/**
 * queues module — call queues (skill groups) in Postgres schema `telephony`.
 * Each queue carries an answer-SLA target used to grade call performance.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("telephony");

export const queues = domainSchema.table("queues", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: varchar("description", { length: 280 }),
  // Target time-to-answer in seconds; calls answered within count toward SLA.
  slaAnswerSeconds: integer("sla_answer_seconds").notNull().default(20),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type QueueRow = typeof queues.$inferSelect;
export type QueueInsert = typeof queues.$inferInsert;

export type QueueView = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  slaAnswerSeconds: number;
  status: string;
  version: number;
};

export const schema = { queues };
