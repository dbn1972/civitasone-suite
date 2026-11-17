/**
 * Section 8 NF-3 (migration 0172): drizzle mirror of the grants-in-aid tables. RLS-scoped (tenant policy, FORCE); amounts are
 * paise (bigint). gl.grant_postings is append-only (database trigger), so it has no update path here.
 */
import { pgSchema, uuid, text, varchar, bigint, date, integer, timestamp, char } from "drizzle-orm/pg-core";

const glSchema = pgSchema("gl");

export const GRANT_CATEGORIES = ["salary", "general", "capital"] as const;
export type GrantCategory = (typeof GRANT_CATEGORIES)[number];
export const GRANT_STATUSES = ["sanctioned", "active", "closed"] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];
export const GRANT_POSTING_KINDS = ["receipt", "recognition", "capitalisation", "release"] as const;
export type GrantPostingKind = (typeof GRANT_POSTING_KINDS)[number];
export const INTEREST_TREATMENTS = ["remit", "adjust", "retain"] as const;
export type InterestTreatment = (typeof INTEREST_TREATMENTS)[number];

export const grants = glSchema.table("grants", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  fundId:                uuid("fund_id").notNull(),
  category:              text("category").$type<GrantCategory>().notNull(),
  grantor:               text("grantor").notNull(),
  schemeCode:            text("scheme_code"),
  sanctionRef:           text("sanction_ref").notNull(),
  sanctionDate:          date("sanction_date").notNull(),
  amountSanctionedMinor: bigint("amount_sanctioned_minor", { mode: "bigint" }).notNull(),
  currency:              char("currency", { length: 3 }).notNull().default("INR"),
  status:                varchar("status", { length: 12 }).$type<GrantStatus>().notNull().default("sanctioned"),
  createdBy:             uuid("created_by").notNull(),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:             uuid("updated_by").notNull(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:               integer("version").notNull().default(1),
});
export type GrantRow = typeof grants.$inferSelect;

export const grantPostings = glSchema.table("grant_postings", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  grantId:     uuid("grant_id").notNull(),
  kind:        text("kind").$type<GrantPostingKind>().notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  postingDate: date("posting_date").notNull(),
  period:      varchar("period", { length: 7 }).notNull(),
  journalId:   uuid("journal_id").notNull(),
  // B1c: the bank head a receipt debited and the effective capital-grant policy at accept time; a replay rebuilds from these.
  bankHeadCode:       text("bank_head_code"),
  capitalGrantPolicy: text("capital_grant_policy").notNull().default("deferred_income"),
  narration:   text("narration"),
  createdBy:   uuid("created_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type GrantPostingRow = typeof grantPostings.$inferSelect;

export const grantUtilisation = glSchema.table("grant_utilisation", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  grantId:             uuid("grant_id").notNull(),
  period:              varchar("period", { length: 7 }).notNull(),
  amountUtilisedMinor: bigint("amount_utilised_minor", { mode: "bigint" }).notNull().default(0n),
  unspentBalanceMinor: bigint("unspent_balance_minor", { mode: "bigint" }).notNull().default(0n),
  interestEarnedMinor: bigint("interest_earned_minor", { mode: "bigint" }).notNull().default(0n),
  interestTreatment:   text("interest_treatment").$type<InterestTreatment>(),
  // The exact UC form number is deliberately free text and NULLABLE: the CA's GFR form answer lands later.
  ucForm:              text("uc_form"),
  ucSubmittedDate:     date("uc_submitted_date"),
  createdBy:           uuid("created_by").notNull(),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:           uuid("updated_by").notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type GrantUtilisationRow = typeof grantUtilisation.$inferSelect;
