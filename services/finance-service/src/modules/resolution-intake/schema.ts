/**
 * Resolution Sanction Intake — schema.
 *
 * Cross-service choreography (Req 22.2): meeting-service publishes
 * `meeting.decision.financial` when a board/committee records a decision with a
 * financial implication. This service opens a PENDING REVIEW item ("action
 * arising from board resolution"). A competent finance officer reviews it and
 * actions it through the normal sanction flow — this intake row NEVER
 * auto-creates a real sanction (GFR / maker-checker is preserved).
 *
 * Lives in the `budget` schema so it reuses `budget.current_tenant_id()` for RLS,
 * mirroring `budget.finance_sanctions`.
 */
import { uuid, text, bigint, char, varchar, timestamp, date, integer } from "drizzle-orm/pg-core";
import { budgetSchema } from "../budget/schema.js";

export const financeResolutionSanctionIntake = budgetSchema.table("finance_resolution_sanction_intake", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  /** Origin system — currently only board meetings. */
  source:        varchar("source", { length: 16 }).notNull().default("meeting"),
  /** meeting-service decision id — unique per tenant (idempotent intake). */
  decisionId:    uuid("decision_id").notNull(),
  meetingId:     uuid("meeting_id"),
  committeeId:   uuid("committee_id"),
  title:         text("title"),
  text:          text("text").notNull(),
  /** Financial implication in paise (parsed from the bus STRING). 0 when absent. */
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  authority:     text("authority"),
  effectiveDate: date("effective_date"),
  /** pending_review | accepted | rejected */
  status:        varchar("status", { length: 24 }).notNull().default("pending_review"),
  reviewedBy:    uuid("reviewed_by"),
  reviewedAt:    timestamp("reviewed_at", { withTimezone: true }),
  note:          text("note"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:       integer("version").notNull().default(1),
});

export type ResolutionSanctionIntakeRow    = typeof financeResolutionSanctionIntake.$inferSelect;
export type ResolutionSanctionIntakeInsert = typeof financeResolutionSanctionIntake.$inferInsert;

export const schema = { financeResolutionSanctionIntake };
