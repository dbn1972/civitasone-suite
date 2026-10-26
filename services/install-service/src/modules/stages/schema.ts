import { pgSchema, uuid, varchar, integer, timestamp, boolean, text, jsonb } from "drizzle-orm/pg-core";

export const installSchema = pgSchema("install");

export const stages = installSchema.table("stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  stepNumber: integer("step_number").notNull(),
  description: varchar("description", { length: 500 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  // Columns added by migration 0002_install_execution.sql (previously missing
  // from this model); 0016 widens the status CHECK so the lifecycle verbs can
  // actually persist in_progress / failed.
  isRequired: boolean("is_required").notNull().default(true),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/**
 * Owner decision #28 (migration 0017): durable per-tenant Domain Pack activation record.
 * accepted -> completed | failed, driven by citizen-service's citizen.pack.domain_activated event.
 */
export const domainPackActivations = installSchema.table("domain_pack_activations", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  domainPackKey: varchar("domain_pack_key", { length: 64 }).notNull(),
  packKeys: jsonb("pack_keys").$type<string[]>().notNull().default([]),
  stageId: uuid("stage_id").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("accepted"),
  draftIds: jsonb("draft_ids").$type<string[]>().notNull().default([]),
  failureReason: text("failure_reason"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type DomainPackActivationRow = typeof domainPackActivations.$inferSelect;
export type DomainPackActivationInsert = typeof domainPackActivations.$inferInsert;

export type DomainPackActivationView = {
  id: string;
  domainPackKey: string;
  packKeys: string[];
  stageId: string;
  status: "accepted" | "completed" | "failed";
  draftIds: string[];
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type StageRow = typeof stages.$inferSelect;
export type StageInsert = typeof stages.$inferInsert;

export type StageView = {
  id: string;
  tenantId: string;
  name: string;
  stepNumber: number;
  description: string | null;
  status: string;
  isRequired: boolean;
  completedAt: string | null;
  errorMessage: string | null;
  version: number;
};

export const schema = { stages, domainPackActivations };
