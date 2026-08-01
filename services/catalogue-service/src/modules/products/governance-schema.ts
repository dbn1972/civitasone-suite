/**
 * products module — Drizzle definitions for the governance / lifecycle /
 * regulatory / availability-v2 / cross-sell tables.
 *
 * These tables were created by migration 0004 and extended by 0005. The column
 * names and CHECK allowlists below mirror those migrations exactly — do not
 * invent values that the database will reject.
 */
import { pgSchema, uuid, varchar, integer, timestamp, boolean, bigint } from "drizzle-orm/pg-core";

export const catalogueSchema = pgSchema("catalogue");

// ─── PC-001: governed versioned product master ─────────────────────────────────

/** CHECK allowlist from 0004: draft | pending_approval | approved | rejected. */
export const PRODUCT_VERSION_STATUSES = ["draft", "pending_approval", "approved", "rejected"] as const;
export type ProductVersionStatus = (typeof PRODUCT_VERSION_STATUSES)[number];

export const productVersions = catalogueSchema.table("product_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  changeSummary: varchar("change_summary"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectionReason: varchar("rejection_reason"),
  /** The MAKER. A checker whose actorId equals this value is rejected with 422. */
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  submittedBy: uuid("submitted_by"),
  rejectedBy: uuid("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  version: integer("version").notNull().default(1),
});

export type ProductVersionRow = typeof productVersions.$inferSelect;
export type ProductVersionInsert = typeof productVersions.$inferInsert;

// ─── PC-002: product lifecycle states ──────────────────────────────────────────

/** CHECK allowlist from 0004: active | sunset | closed_to_new_business | retired. */
export const PRODUCT_LIFECYCLE_STATES = ["active", "sunset", "closed_to_new_business", "retired"] as const;
export type ProductLifecycleState = (typeof PRODUCT_LIFECYCLE_STATES)[number];

/** Append-only history: the newest effectiveFrom row is the current state. */
export const productLifecycle = catalogueSchema.table("product_lifecycle", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  state: varchar("state", { length: 32 }).notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  reason: varchar("reason"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductLifecycleRow = typeof productLifecycle.$inferSelect;
export type ProductLifecycleInsert = typeof productLifecycle.$inferInsert;

// ─── PC-003: regulatory metadata ───────────────────────────────────────────────

/** CHECK allowlist from 0004: compliant | non_compliant | pending_review. */
export const COMPLIANCE_STATUSES = ["compliant", "non_compliant", "pending_review"] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const regulatoryMetadata = catalogueSchema.table("regulatory_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  regulation: varchar("regulation", { length: 200 }).notNull(),
  complianceStatus: varchar("compliance_status", { length: 24 }).notNull().default("pending_review"),
  notes: varchar("notes"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewerId: uuid("reviewer_id"),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  /** Drives GET /v1/catalogue/regulatory/expiring?withinDays=N. */
  validUntil: timestamp("valid_until", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type RegulatoryMetadataRow = typeof regulatoryMetadata.$inferSelect;
export type RegulatoryMetadataInsert = typeof regulatoryMetadata.$inferInsert;

// ─── PC-004: circle / region / office availability flags ───────────────────────

export const productAvailabilityV2 = catalogueSchema.table("product_availability_v2", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  /** Added in 0005. NULL = applies to every circle (broadest default). */
  circleCode: varchar("circle_code", { length: 50 }),
  regionCode: varchar("region_code", { length: 50 }),
  officeCode: varchar("office_code", { length: 50 }),
  available: boolean("available").notNull().default(true),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type ProductAvailabilityV2Row = typeof productAvailabilityV2.$inferSelect;
export type ProductAvailabilityV2Insert = typeof productAvailabilityV2.$inferInsert;

// ─── PC-008: cross-sell relationships ──────────────────────────────────────────

/** CHECK allowlist from 0004: cross_sell | upsell | complementary. */
export const CROSS_SELL_RULE_TYPES = ["cross_sell", "upsell", "complementary"] as const;
export type CrossSellRuleType = (typeof CROSS_SELL_RULE_TYPES)[number];

export const crossSellRules = catalogueSchema.table("cross_sell_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  sourceProductId: uuid("source_product_id").notNull(),
  targetProductId: uuid("target_product_id").notNull(),
  ruleType: varchar("rule_type", { length: 24 }).notNull().default("cross_sell"),
  priority: integer("priority").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  note: varchar("note", { length: 500 }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type CrossSellRuleRow = typeof crossSellRules.$inferSelect;
export type CrossSellRuleInsert = typeof crossSellRules.$inferInsert;

// ─── PC-006: bundle pricing approvals ──────────────────────────────────────────

/** CHECK allowlist from 0004: pending | approved | rejected. */
export const BUNDLE_APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type BundleApprovalStatus = (typeof BUNDLE_APPROVAL_STATUSES)[number];

export const bundleApprovals = catalogueSchema.table("bundle_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bundleId: uuid("bundle_id").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  /** The MAKER. A decider whose actorId equals this value is rejected with 422. */
  requestedBy: uuid("requested_by").notNull(),
  approvedBy: uuid("approved_by"),
  reason: varchar("reason"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  /** MONEY RULE: minor units (paise) as bigint. Serialised as a JSON string. */
  pricingAmountMinor: bigint("pricing_amount_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type BundleApprovalRow = typeof bundleApprovals.$inferSelect;
export type BundleApprovalInsert = typeof bundleApprovals.$inferInsert;

export const governanceSchema = {
  productVersions,
  productLifecycle,
  regulatoryMetadata,
  productAvailabilityV2,
  crossSellRules,
  bundleApprovals,
};
