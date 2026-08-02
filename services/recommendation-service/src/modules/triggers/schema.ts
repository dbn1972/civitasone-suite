/**
 * triggers module — GENERIC, tenant-configurable cross-sell trigger rules.
 *
 * One table, three rule types, no product-specific columns. The rule types are
 * capability shapes, not products:
 *
 *   holding_based  — "the subject already holds something in category X, so offer
 *                    category Y". Covers any held-portfolio cross-sell, including
 *                    offering a protection/insurance category off a savings-type
 *                    base (RTM row IN-007).
 *   life_event     — "an event of code E happened (or is about to), so offer
 *                    category Y". Covers maturity-approaching, address change and
 *                    age thresholds (RTM row FS-006).
 *   volume_pattern — "the subject's shipping-lane / volume behaviour crossed a
 *                    configured threshold, so offer category Y". Covers premium
 *                    product leads off lane patterns (RTM row MP-011).
 *
 * `sourceCategory` / `targetCategory` / `eventCode` are opaque tenant-defined
 * STRINGS, deliberately not enums: the platform must not know what any particular
 * deployment calls its savings, protection or premium-logistics categories. The
 * mapping from a deployment's real product catalogue onto these categories belongs
 * in that deployment's adapter, not here.
 */
import {
  pgSchema,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const recommendationSchema = pgSchema("recommendation");

/** The three generic rule shapes. Extend by adding a shape, never a product. */
export const TRIGGER_RULE_TYPES = ["holding_based", "life_event", "volume_pattern"] as const;
export type TriggerRuleType = (typeof TRIGGER_RULE_TYPES)[number];

/**
 * Condition grammar. Every key is OPTIONAL and every key is a threshold: a rule
 * fires when the observation satisfies ALL the thresholds the rule declares. A
 * rule declaring no conditions fires on any matching observation of its type.
 *
 * Monetary thresholds are decimal STRINGS of bigint minor units — never numbers —
 * so a threshold above 2^53 cannot lose precision on the way through JSON.
 */
// Every key is spelled `?: T | undefined` rather than `?: T` so a bag built under
// exactOptionalPropertyTypes — where an absent zod key is present-and-undefined —
// is assignable without a cast.
export interface TriggerConditions {
  /** holding_based — at least this many holdings in `sourceCategory`. */
  minHoldingCount?: number | undefined;
  /** holding_based — aggregate held value in `sourceCategory`, minor units as a string. */
  minHoldingValueMinor?: string | undefined;
  /** life_event — the event must occur within this many days of `asOf` (past or future). */
  withinDays?: number | undefined;
  /** life_event — subject age must be at least this, in whole years. */
  minAgeYears?: number | undefined;
  /** life_event — subject age must be at most this, in whole years. */
  maxAgeYears?: number | undefined;
  /** volume_pattern — at least this many consignments in the observation window. */
  minVolume?: number | undefined;
  /** volume_pattern — at least this many distinct lanes in the observation window. */
  minDistinctLanes?: number | undefined;
  /** volume_pattern — aggregate consignment value, minor units as a string. */
  minValueMinor?: string | undefined;
  /** volume_pattern — the observation window must be at least this many days wide. */
  minWindowDays?: number | undefined;
}

/** A tenant-configured trigger rule. */
export const triggerRules = recommendationSchema.table(
  "trigger_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** One of TRIGGER_RULE_TYPES. */
    ruleType: varchar("rule_type", { length: 32 }).notNull(),
    /** Operator-facing label. */
    name: varchar("name", { length: 128 }).notNull(),
    /** Tenant-defined product category the subject must already hold (holding_based). */
    sourceCategory: varchar("source_category", { length: 64 }),
    /** Tenant-defined product category to recommend when the rule fires. */
    targetCategory: varchar("target_category", { length: 64 }).notNull(),
    /** Tenant-defined life-event code (life_event). */
    eventCode: varchar("event_code", { length: 64 }),
    conditions: jsonb("conditions").$type<TriggerConditions>().notNull().default({}),
    priority: integer("priority").notNull().default(0),
    /** Weight in BASIS POINTS (10000 = 100%) — a ratio, so integer bps, not money. */
    weightBps: integer("weight_bps").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** Inclusive lower bound of the rule's live window. NULL = live already. */
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    /** Exclusive upper bound of the rule's live window. NULL = never expires. */
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => ({
    tenantTypeIdx: index("idx_trigger_rules_tenant_type").on(t.tenantId, t.ruleType),
  }),
);

export type TriggerRuleRow = typeof triggerRules.$inferSelect;
export type TriggerRuleInsert = typeof triggerRules.$inferInsert;

export const schema = { triggerRules };
