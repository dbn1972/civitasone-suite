/**
 * rates module — Drizzle definition for the inbound rate-change request log
 * (`billing.rate.change_requested`). Created by migration 0007.
 *
 * Every payload-derived column is NULLABLE on purpose: billing-service owns the
 * payload shape, so a malformed foreign event must still be recordable as a
 * rejection. Only the envelope-derived columns (tenant, actor, source message)
 * are NOT NULL, because those are the ones we can always trust.
 */
import { pgSchema, uuid, varchar, integer, timestamp, date, bigint } from "drizzle-orm/pg-core";

export const catalogueSchema = pgSchema("catalogue");

/** CHECK allowlist from migration 0007. */
export const RATE_CHANGE_OUTCOMES = ["accepted", "rejected"] as const;
export type RateChangeOutcome = (typeof RATE_CHANGE_OUTCOMES)[number];

export const rateChangeRequests = catalogueSchema.table("rate_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  /**
   * Deduplication anchor. UNIQUE (tenant_id, source_message_id) in the database,
   * so even a bug that bypassed markProcessed cannot double-record a redelivery.
   */
  sourceMessageId: uuid("source_message_id").notNull(),
  /** billing-service's own request identifier. Opaque string, not a catalogue id. */
  requestId: varchar("request_id", { length: 200 }),
  productId: uuid("product_id"),
  rateId: uuid("rate_id"),
  /** MONEY RULE: minor units (paise) as bigint. Serialised as a JSON string. */
  requestedRateMinor: bigint("requested_rate_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }),
  effectiveFrom: date("effective_from"),
  requestReason: varchar("request_reason", { length: 500 }),
  outcome: varchar("outcome", { length: 24 }).notNull(),
  rejectionCode: varchar("rejection_code", { length: 64 }),
  rejectionReason: varchar("rejection_reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RateChangeRequestRow = typeof rateChangeRequests.$inferSelect;
export type RateChangeRequestInsert = typeof rateChangeRequests.$inferInsert;

export const changeRequestSchema = { rateChangeRequests };
