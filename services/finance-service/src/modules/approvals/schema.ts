import { pgSchema, uuid, varchar, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

const glSchema = pgSchema("gl");

/** Per-tenant finance policy switches (migrations/0081_finance_fp01_change_requests.sql). */
export const financeSettings = glSchema.table("finance_settings", {
  tenantId:                            uuid("tenant_id").primaryKey(),
  makerCheckerEnabled:                 boolean("maker_checker_enabled").notNull().default(true),
  blockFyActivationOpenPeriods:        boolean("block_fy_activation_open_periods").notNull().default(true),
  requireOpeningBalancesForActivation: boolean("require_opening_balances_for_activation").notNull().default(false),
  fyCreateAsDraft:                     boolean("fy_create_as_draft").notNull().default(true),
  debtLoanLiabilityHeadId:             uuid("debt_loan_liability_head_id"),
  debtInterestExpenseHeadId:           uuid("debt_interest_expense_head_id"),
  debtBankHeadId:                      uuid("debt_bank_head_id"),
  updatedBy:                           uuid("updated_by").notNull(),
  updatedAt:                           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:                             integer("version").notNull().default(1),
});

/** Maker-checker change request (pending -> approved | rejected | cancelled). */
export const financeChangeRequests = glSchema.table("finance_change_requests", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  kind:         varchar("kind", { length: 32 }).notNull(),
  subjectKey:   text("subject_key").notNull(),
  payload:      jsonb("payload").$type<Record<string, unknown>>().notNull(),
  reason:       text("reason").notNull(),
  status:       varchar("status", { length: 16 }).notNull().default("pending"),
  requestedBy:  uuid("requested_by").notNull(),
  requestedAt:  timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy:    uuid("decided_by"),
  decidedAt:    timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  version:      integer("version").notNull().default(1),
});

export type FinanceSettingsRow = typeof financeSettings.$inferSelect;
export type ChangeRequestRow = typeof financeChangeRequests.$inferSelect;

export const schema = { financeSettings, financeChangeRequests };
