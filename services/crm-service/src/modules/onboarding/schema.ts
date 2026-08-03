/**
 * onboarding module — Drizzle schema for crm.onboarding_cases (P1-9).
 *
 * `dealId` / `accountId` are opaque ids into the deals and accounts domains: this
 * module never joins to them, it only records what the deal-won event told it.
 */
import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const onboardingCases = crmSchema.table("onboarding_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  dealId: uuid("deal_id").notNull(),
  accountId: uuid("account_id"),
  stage: varchar("stage", { length: 24 }).notNull().default("initiated"),
  kycStatus: varchar("kyc_status", { length: 16 }).notNull().default("pending"),
  kycReference: varchar("kyc_reference", { length: 120 }),
  kycVerifiedAt: timestamp("kyc_verified_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type OnboardingCaseRow = typeof onboardingCases.$inferSelect;
export type OnboardingCaseInsert = typeof onboardingCases.$inferInsert;

export type OnboardingCaseView = {
  id: string;
  tenantId: string;
  dealId: string;
  accountId: string | null;
  stage: string;
  kycStatus: string;
  kycReference: string | null;
  kycVerifiedAt: string | null;
  completedAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export const schema = { onboardingCases };
