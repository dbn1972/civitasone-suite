/**
 * intelligence module — F.6 key-account intelligence (white space, risk, opportunity).
 */
import { pgSchema, uuid, integer, timestamp, jsonb, numeric, unique } from "drizzle-orm/pg-core";

export const recommendationSchema = pgSchema("recommendation");

/** White-space entry: a product/category the account does not own yet. */
export interface WhiteSpaceEntry {
  productId: string;
  label?: string;
  /** Decimal STRING — an estimated deal value must not go through a float. */
  estimatedValue?: string;
}

/** Detected relationship risk. */
export interface RiskSignal {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  note?: string;
}

/** One live intelligence record per account; recompute upserts in place. */
export const accountIntelligence = recommendationSchema.table(
  "account_intelligence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    accountId: uuid("account_id").notNull(),
    whiteSpace: jsonb("white_space").$type<WhiteSpaceEntry[]>().notNull().default([]),
    riskSignals: jsonb("risk_signals").$type<RiskSignal[]>().notNull().default([]),
    /** numeric(6,4) — returned as a string by the driver and kept as one in JSON. */
    opportunityScore: numeric("opportunity_score", { precision: 6, scale: 4 }).notNull().default("0"),
    lastComputedAt: timestamp("last_computed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => ({
    accountUnique: unique("uq_account_intelligence_account").on(t.tenantId, t.accountId),
  }),
);

export type AccountIntelligenceRow = typeof accountIntelligence.$inferSelect;
export type AccountIntelligenceInsert = typeof accountIntelligence.$inferInsert;

export const schema = { accountIntelligence };
