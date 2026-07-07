/**
 * Anomaly Detection Schema
 *
 * Stores flagged financial transaction anomalies detected by the ML system.
 * Supports Z-score, duplicate, cost-center pattern, and user behavior anomaly types.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  numeric,
  index,
} from "drizzle-orm/pg-core";

export const financeAnomalies = pgTable(
  "finance_anomalies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    transactionId: uuid("transaction_id").notNull(),
    /** Type of anomaly: zscore | duplicate | cost_center_pattern | user_behavior */
    anomalyType: text("anomaly_type").notNull(),
    /** Severity: low | medium | high (Z-score > 5 = high, 3-5 = medium, else low) */
    severity: text("severity").notNull(),
    /** Status: open | reviewed | dismissed */
    status: text("status").notNull().default("open"),
    /** Z-score value (for zscore type) */
    zScore: numeric("z_score", { precision: 8, scale: 4 }),
    /** Contributing factors for explainability */
    factors: jsonb("factors").notNull().default([]),
    /** Vendor ID associated with the transaction */
    vendorId: text("vendor_id"),
    /** Category ID associated with the transaction */
    categoryId: text("category_id"),
    /** Transaction amount in paise */
    amountPaise: text("amount_paise"),
    /** Dismissed by (user ID) */
    dismissedBy: uuid("dismissed_by"),
    /** Dismissal reason */
    dismissReason: text("dismiss_reason"),
    /** Dismissed at timestamp */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    /** Correlation ID for tracing */
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => ({
    tenantStatusIdx: index("idx_finance_anomalies_tenant_status").on(t.tenantId, t.status),
    transactionIdx: index("idx_finance_anomalies_transaction").on(t.tenantId, t.transactionId),
    createdAtIdx: index("idx_finance_anomalies_created_at").on(t.createdAt),
  })
);

export const schema = { financeAnomalies };
