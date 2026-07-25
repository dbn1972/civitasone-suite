import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

/**
 * SVC-049 Vendor performance — lives in the existing `vendor` schema.
 * Kept in a separate file from the PII-encrypted vendor schema so the
 * scorecard tables (no PII) stay clearly non-sensitive.
 */
export const vendorPerfSchema = pgSchema("vendor");

/** Immutable ledger of performance signals (GRN / contract / manual). */
export const procurementVendorPerformanceEvents = vendorPerfSchema.table("procurement_vendor_performance_events", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  vendorId:   uuid("vendor_id").notNull(),
  eventType:  varchar("event_type", { length: 24 }).notNull(),
  source:     varchar("source", { length: 16 }).notNull().default("grn"),
  sourceRef:  text("source_ref"),
  poRef:      text("po_ref"),
  weight:     integer("weight").notNull().default(1),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
});

/** Objective scorecard derived from the performance-event ledger. */
export const procurementVendorScorecards = vendorPerfSchema.table("procurement_vendor_scorecards", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  vendorId:         uuid("vendor_id").notNull(),
  period:           varchar("period", { length: 16 }).notNull().default("all"),
  totalOrders:      integer("total_orders").notNull().default(0),
  onTimeDeliveries: integer("on_time_deliveries").notNull().default(0),
  lateDeliveries:   integer("late_deliveries").notNull().default(0),
  qualityRejections:integer("quality_rejections").notNull().default(0),
  slaBreaches:      integer("sla_breaches").notNull().default(0),
  deliveryScore:    integer("delivery_score").notNull().default(0),
  qualityScore:     integer("quality_score").notNull().default(0),
  slaScore:         integer("sla_score").notNull().default(0),
  overallRating:    integer("overall_rating").notNull().default(0),
  ratingBand:       varchar("rating_band", { length: 8 }).notNull().default("unrated"),
  computedAt:       timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:          integer("version").notNull().default(1),
});

/** Show-cause notice → response → appeal → decision workflow. */
export const procurementVendorShowCause = vendorPerfSchema.table("procurement_vendor_show_cause", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  vendorId:    uuid("vendor_id").notNull(),
  reason:      text("reason").notNull(),
  status:      varchar("status", { length: 16 }).notNull().default("issued"),
  issuedBy:    uuid("issued_by").notNull(),
  response:    text("response"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  appealText:  text("appeal_text"),
  appealedAt:  timestamp("appealed_at", { withTimezone: true }),
  decidedBy:   uuid("decided_by"),
  decision:    text("decision"),
  decidedAt:   timestamp("decided_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type PerfEventRow    = typeof procurementVendorPerformanceEvents.$inferSelect;
export type PerfEventInsert = typeof procurementVendorPerformanceEvents.$inferInsert;
export type ScorecardRow    = typeof procurementVendorScorecards.$inferSelect;
export type ScorecardInsert = typeof procurementVendorScorecards.$inferInsert;
export type ShowCauseRow    = typeof procurementVendorShowCause.$inferSelect;
export type ShowCauseInsert = typeof procurementVendorShowCause.$inferInsert;

export const scorecardSchema = {
  procurementVendorPerformanceEvents,
  procurementVendorScorecards,
  procurementVendorShowCause,
};
