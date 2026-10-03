import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp, jsonb,
} from "drizzle-orm/pg-core";

export const insuranceSchema = pgSchema("insurance");

/** A supporting document of a claim: the upload key (see admin-service uploads) plus what the browser reported. */
export type ClaimAttachment = { key: string; fileName: string; size: number; mimeType: string };

export const assetPolicies = insuranceSchema.table("asset_policies", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  assetId:             uuid("asset_id").notNull(),
  policyNo:            text("policy_no").notNull(),
  insurer:             text("insurer").notNull(),
  coverageMinor:       bigint("coverage_minor", { mode: "bigint" }).notNull().default(0n),
  premiumMinor:        bigint("premium_minor", { mode: "bigint" }).notNull().default(0n),
  currency:            char("currency", { length: 3 }).notNull().default("INR"),
  startDate:           date("start_date").notNull(),
  endDate:             date("end_date").notNull(),
  renewalReminderDays: integer("renewal_reminder_days").notNull().default(30),
  status:              varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export const assetClaims = insuranceSchema.table("asset_claims", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  policyId:           uuid("policy_id").notNull(),
  assetId:            uuid("asset_id").notNull(),
  claimDate:          date("claim_date").notNull(),
  claimAmountMinor:   bigint("claim_amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:           char("currency", { length: 3 }).notNull().default("INR"),
  status:             varchar("status", { length: 16 }).notNull().default("pending"),
  settledAmountMinor: bigint("settled_amount_minor", { mode: "bigint" }).notNull().default(0n),
  notes:              text("notes"),
  // GAP-ASSETS-INSURANCE-CLAIMS-06 (migration 0038): supporting documents, as upload references.
  attachments:        jsonb("attachments").$type<ClaimAttachment[]>().notNull().default([]),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

export type PolicyRow    = typeof assetPolicies.$inferSelect;
export type PolicyInsert = typeof assetPolicies.$inferInsert;
export type ClaimRow     = typeof assetClaims.$inferSelect;
export type ClaimInsert  = typeof assetClaims.$inferInsert;

export const schema = { assetPolicies, assetClaims };
