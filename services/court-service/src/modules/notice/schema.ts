/**
 * notice — Drizzle table definitions.
 *
 * These tables live in the `court` PostgreSQL schema and mirror, column-for-column,
 * the DDL created by migrations/0003_court_notice.sql.
 *
 * Scope: notices, notice_service (§21 issuance & service of process).
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 */
import { pgSchema, uuid, text, integer, date, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Notices ────────────────────────────────────────────────────────────────────

export const notices = courtSchema.table("notices", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  caseId:     uuid("case_id").notNull(),
  noticeType: varchar("notice_type", { length: 48 }).notNull(),
  issuedTo:   text("issued_to"),
  status:     varchar("status", { length: 16 }).notNull().default("issued"),
  issueDate:  date("issue_date").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by"),
  updatedBy:  uuid("updated_by"),
  version:    integer("version").notNull().default(1),
});

// ─── Notice Service Attempts ────────────────────────────────────────────────────

export const noticeService = courtSchema.table("notice_service", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  noticeId:       uuid("notice_id").notNull(),
  serviceMode:    varchar("service_mode", { length: 24 }).notNull(),
  recipient:      text("recipient"),
  dispatchRef:    varchar("dispatch_ref", { length: 64 }),
  deliveryStatus: varchar("delivery_status", { length: 16 }).notNull().default("pending"),
  servedAt:       date("served_at"),
  proof:          text("proof"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by"),
  updatedBy:      uuid("updated_by"),
  version:        integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type NoticeRow    = typeof notices.$inferSelect;
export type NoticeInsert = typeof notices.$inferInsert;

export type NoticeServiceRow    = typeof noticeService.$inferSelect;
export type NoticeServiceInsert = typeof noticeService.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const noticeSchema = {
  notices,
  noticeService,
};
