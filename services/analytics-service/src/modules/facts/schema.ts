/**
 * facts module — analytics' OWN projection of cross-domain events.
 * Drizzle schema in Postgres schema `analytics`. The whitelisted query builder
 * runs ONLY against this table (never user SQL, never another service's DB).
 */
import { pgSchema, uuid, varchar, bigint, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("analytics");

export const factEvents = domainSchema.table("fact_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  source: varchar("source", { length: 32 }).notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  category: varchar("category", { length: 64 }).notNull().default("general"),
  status: varchar("status", { length: 32 }).notNull().default("unknown"),
  // Money in PAISE (minor units) — never float/numeric. BigInt mode returns bigint.
  amount: bigint("amount", { mode: "bigint" }).notNull().default(0n),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  dedupeKey: varchar("dedupe_key", { length: 128 }).notNull(),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FactEventRow = typeof factEvents.$inferSelect;
export type FactEventInsert = typeof factEvents.$inferInsert;

export const schema = { factEvents };
