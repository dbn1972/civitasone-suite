/**
 * condemnation module — Condemnation survey, committee recommendation,
 * reserve/floor value, auction, and retirement (SVC-060).
 *
 * Workflow:
 *   1. Condemnation survey (physical assessment → condition report)
 *   2. Committee recommendation (condemn/repair/continue)
 *   3. If condemned → set reserve/floor value → initiate auction
 *   4. Auction → sale proceeds → finance receipt
 *   5. Asset retirement → depreciation stop
 *
 * PG Schema: `lifecycle` (same as existing disposal tables)
 * All money as bigint paise. Optimistic locking via `version`.
 */
import {
  pgSchema, uuid, text, varchar, integer, bigint, char, date, timestamp, jsonb, numeric,
} from "drizzle-orm/pg-core";

export const condemnationSchema = pgSchema("lifecycle");

/** Condemnation survey — physical assessment of an asset's condition. */
export const condemnationSurveys = condemnationSchema.table("condemnation_surveys", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assetId:        uuid("asset_id").notNull(),
  surveyDate:     date("survey_date").notNull(),
  surveyedBy:     uuid("surveyed_by").notNull(),
  condition:      varchar("condition", { length: 32 }).notNull(),
  conditionNotes: text("condition_notes"),
  yearsInUse:     integer("years_in_use"),
  estimatedRepairCostMinor: bigint("estimated_repair_cost_minor", { mode: "bigint" }),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  recommendation: varchar("recommendation", { length: 32 }).notNull().default("pending"),
  attachments:    jsonb("attachments"),
  status:         varchar("status", { length: 24 }).notNull().default("draft"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

/**
 * Committee recommendation — condemnation board's decision.
 * Maker-checker: recommender ≠ approver (GFR Rule 196).
 */
export const condemnationRecommendations = condemnationSchema.table("condemnation_recommendations", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  surveyId:       uuid("survey_id").notNull(),
  assetId:        uuid("asset_id").notNull(),
  committeeMembers: jsonb("committee_members").notNull(),
  decision:       varchar("decision", { length: 32 }).notNull(),
  reason:         text("reason").notNull(),
  reserveValueMinor: bigint("reserve_value_minor", { mode: "bigint" }),
  floorValueMinor:   bigint("floor_value_minor", { mode: "bigint" }),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  approvedBy:     uuid("approved_by"),
  approvedAt:     timestamp("approved_at", { withTimezone: true }),
  status:         varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

/**
 * Asset auction — links to procurement e-auction system.
 * Sale proceeds flow to finance receipt on completion.
 */
export const assetAuctions = condemnationSchema.table("asset_auctions", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  assetId:           uuid("asset_id").notNull(),
  recommendationId:  uuid("recommendation_id").notNull(),
  reserveValueMinor: bigint("reserve_value_minor", { mode: "bigint" }).notNull(),
  currency:          char("currency", { length: 3 }).notNull().default("INR"),
  auctionRef:        text("auction_ref"),
  auctionDate:       date("auction_date"),
  highestBidMinor:   bigint("highest_bid_minor", { mode: "bigint" }),
  winnerName:        text("winner_name"),
  winnerRef:         text("winner_ref"),
  saleProceedsMinor: bigint("sale_proceeds_minor", { mode: "bigint" }),
  financeReceiptRef: text("finance_receipt_ref"),
  status:            varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export type CondemnationSurveyRow    = typeof condemnationSurveys.$inferSelect;
export type CondemnationSurveyInsert = typeof condemnationSurveys.$inferInsert;
export type RecommendationRow    = typeof condemnationRecommendations.$inferSelect;
export type RecommendationInsert = typeof condemnationRecommendations.$inferInsert;
export type AuctionRow    = typeof assetAuctions.$inferSelect;
export type AuctionInsert = typeof assetAuctions.$inferInsert;

export const schema = { condemnationSurveys, condemnationRecommendations, assetAuctions };
