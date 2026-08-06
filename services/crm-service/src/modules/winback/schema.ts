import {
  pgSchema,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

// ── Trigger criteria shape ──────────────────────────────────────────────────

/** JSON shape stored in winback_cadences.trigger_criteria. */
export interface TriggerCriteria {
  /** Days of account inactivity required to match (e.g. 90). */
  inactiveDays?: number | undefined;
  /** Minimum transaction decline percentage to match (e.g. 30 means ≥30% drop). */
  declinePct?: number | undefined;
  /** Whether the account must have a recent complaint to qualify. */
  hasRecentComplaint?: boolean | undefined;
}

// ── Step shape ──────────────────────────────────────────────────────────────

export interface CadenceStep {
  ordinal: number;
  delayDays: number;
  actionType: string;
  templateRef?: string | undefined;
}

// ── winback_cadences ────────────────────────────────────────────────────────

export const winbackCadences = crmSchema.table("winback_cadences", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  triggerCriteria: jsonb("trigger_criteria").$type<TriggerCriteria>().notNull().default({}),
  steps: jsonb("steps").$type<CadenceStep[]>().notNull().default([]),
  status: varchar("status", { length: 12 }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WinbackCadenceRow = typeof winbackCadences.$inferSelect;
export type WinbackCadenceInsert = typeof winbackCadences.$inferInsert;

export interface WinbackCadenceView {
  id: string;
  tenantId: string;
  name: string;
  triggerCriteria: TriggerCriteria;
  steps: CadenceStep[];
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── winback_enrollments ─────────────────────────────────────────────────────

export const winbackEnrollments = crmSchema.table("winback_enrollments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  cadenceId: uuid("cadence_id").notNull(),
  accountId: uuid("account_id").notNull(),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  currentStep: integer("current_step").notNull().default(0),
  status: varchar("status", { length: 12 }).notNull().default("active"),
  outcome: varchar("outcome", { length: 16 }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WinbackEnrollmentRow = typeof winbackEnrollments.$inferSelect;
export type WinbackEnrollmentInsert = typeof winbackEnrollments.$inferInsert;

export interface WinbackEnrollmentView {
  id: string;
  tenantId: string;
  cadenceId: string;
  accountId: string;
  enrolledAt: string;
  currentStep: number;
  status: string;
  outcome: string | null;
  convertedAt: string | null;
  version: number;
}

export const schema = { winbackCadences, winbackEnrollments };
