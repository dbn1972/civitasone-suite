/**
 * segments module — Drizzle schema (G5).
 *
 * Two tables:
 *  - `crm.segment_definitions` — the customer-segment taxonomy. One row per
 *    (tenant, segmentCode). A segment carries its PRIORITY PRODUCTS (ordered — the
 *    order IS the priority) and its PRIMARY CHANNELS, which is the mapping the
 *    recommendation/channel-selection seam reads.
 *  - `crm.segment_settings` — the per-tenant switch that turns catalogue enforcement
 *    on for `crm.contacts.segment`. Defaults to OFF so existing tenants, whose
 *    `segment` column holds free text, see no behaviour change at all.
 *
 * `crm.contacts.segment` is deliberately left exactly as it is (varchar(64), free
 * text). Nothing here removes, renames or rewrites it.
 */
import { pgSchema, uuid, varchar, text, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

/** Lifecycle of a segment definition. Only `published` segments are enforceable. */
export const SEGMENT_STATUSES = ["draft", "published", "deprecated"] as const;
export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];

/**
 * Who owns the row. `canonical` rows are delivered as reference data (seed) and are
 * immutable through the API; `tenant` rows are the deployment's own additions.
 */
export const SEGMENT_GOVERNANCES = ["canonical", "tenant"] as const;
export type SegmentGovernance = (typeof SEGMENT_GOVERNANCES)[number];

export const segmentDefinitions = crmSchema.table("segment_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  /** Stable machine key. Unique per tenant, never reused — see migration 0086. */
  segmentCode: varchar("segment_code", { length: 64 }).notNull(),
  displayName: varchar("display_name", { length: 200 }).notNull(),
  description: text("description"),
  governance: varchar("governance", { length: 16 }).notNull().default("tenant"),
  /** Ordered array of product codes. Index 0 is the highest priority. */
  priorityProducts: jsonb("priority_products").$type<string[]>().notNull().default([]),
  /** Channel codes from the service's single channel vocabulary (leads/channels.ts). */
  primaryChannels: jsonb("primary_channels").$type<string[]>().notNull().default([]),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  /**
   * Taxonomy revision, bumped on publish. Distinct from `version`: `version` is the
   * optimistic-locking counter bumped on every write, `versionNumber` is the number a
   * consumer of the eligibility contract can quote ("we scored against revision 3").
   */
  versionNumber: integer("version_number").notNull().default(1),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
  /** Soft-delete marker — DELETE never removes the row (see routes.ts). */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const segmentSettings = crmSchema.table("segment_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  /**
   * OFF by default. When false the classification command behaves exactly as it did
   * before this module existed — any free-text segment value is accepted.
   */
  enforceSegmentCatalogue: boolean("enforce_segment_catalogue").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type SegmentDefinitionRow = typeof segmentDefinitions.$inferSelect;
export type SegmentDefinitionInsert = typeof segmentDefinitions.$inferInsert;
export type SegmentSettingsRow = typeof segmentSettings.$inferSelect;

export interface SegmentDefinitionView {
  id: string;
  tenantId: string;
  segmentCode: string;
  displayName: string;
  description: string | null;
  governance: SegmentGovernance;
  priorityProducts: string[];
  primaryChannels: string[];
  status: SegmentStatus;
  versionNumber: number;
  publishedAt: string | null;
  deprecatedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The eligibility read contract (G5 §3), consumed by recommendation-service.
 *
 * STABLE: fields are only ever added, never removed or reordered, and
 * `priorityProducts` is always returned in descending priority order.
 */
export interface SegmentEligibilityView {
  segmentCode: string;
  displayName: string;
  status: SegmentStatus;
  versionNumber: number;
  /** Highest priority first. */
  priorityProducts: string[];
  /** Preferred channel first. */
  primaryChannels: string[];
  publishedAt: string | null;
}

export interface SegmentSettingsView {
  tenantId: string;
  enforceSegmentCatalogue: boolean;
  version: number;
  updatedAt: string | null;
}

export const schema = { segmentDefinitions, segmentSettings };
