import { pgSchema, uuid, varchar, text, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * SVC-130 Change, Release & User Communication.
 *
 * A governed change/release process distinct from support:
 *   change_requests → CAB approval (maker-checker) → scheduled release window
 *   (freeze-checked) → execution → post-implementation review (PIR).
 * change_freezes hold blackout windows that block scheduling.
 * change_audit is the immutable trail of every state transition.
 */
export const changeSchema = pgSchema("change");

export const changeRequests = changeSchema.table("change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  title: text("title").notNull(),
  // standard | normal | emergency
  type: varchar("type", { length: 16 }).notNull(),
  // low | medium | high
  risk: varchar("risk", { length: 16 }).notNull().default("medium"),
  affectedServices: jsonb("affected_services").$type<string[]>().notNull().default([]),
  description: text("description").notNull(),
  // Required before CAB approval (SVC-130 rollback-plan guard).
  rollbackPlan: text("rollback_plan"),
  // draft | submitted | approved | rejected | scheduled | in_progress | completed | rolled_back
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  requestedBy: uuid("requested_by").notNull(),
  // Maker-checker: the approving CAB member; must differ from requestedBy.
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  // Scheduled release window (freeze-checked at schedule time).
  windowStart: timestamp("window_start", { withTimezone: true }),
  windowEnd: timestamp("window_end", { withTimezone: true }),
  // User-communication broadcast copy, emitted to notification-service on release.
  releaseNotes: text("release_notes"),
  // Post-implementation review: success | rolled_back
  pirOutcome: varchar("pir_outcome", { length: 16 }),
  pirNotes: text("pir_notes"),
  pirAt: timestamp("pir_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const changeFreezes = changeSchema.table("change_freezes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const changeAudit = changeSchema.table("change_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  changeId: uuid("change_id").notNull(),
  fromStatus: varchar("from_status", { length: 24 }),
  toStatus: varchar("to_status", { length: 24 }).notNull(),
  actorId: uuid("actor_id").notNull(),
  note: text("note"),
  correlationId: varchar("correlation_id", { length: 64 }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChangeRequestRow = typeof changeRequests.$inferSelect;
export type ChangeRequestInsert = typeof changeRequests.$inferInsert;
export type ChangeFreezeRow = typeof changeFreezes.$inferSelect;
export type ChangeFreezeInsert = typeof changeFreezes.$inferInsert;
export type ChangeAuditInsert = typeof changeAudit.$inferInsert;

export const schema = { changeRequests, changeFreezes, changeAudit };
