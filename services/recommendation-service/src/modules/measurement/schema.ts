/**
 * measurement module — XS-003 cross-sell measurement.
 *
 * Two tables, because attach rate and uplift are a ratio and a ratio needs a
 * denominator that outcomes alone cannot supply:
 *
 *   cross_sell_exposures    — the DENOMINATOR. One row per subject per experiment,
 *                             recording which cohort it landed in. A control/holdout
 *                             subject appears here and receives no recommendation,
 *                             which is precisely what makes it a control.
 *   cross_sell_attributions — the NUMERATOR. One row per outcome, carrying the
 *                             recommendation credited with it (null for a control
 *                             subject, which by definition was never served one).
 *
 * `campaignKey`, `outcomeType` and `cohort` values are tenant-defined strings, so
 * the platform never needs to know what a deployment sells or what it calls its
 * experiments.
 */
import {
  pgSchema,
  uuid,
  varchar,
  integer,
  bigint,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";

export const recommendationSchema = pgSchema("recommendation");

/** The two cohorts an uplift measurement compares. */
export const COHORTS = ["treatment", "control"] as const;
export type Cohort = (typeof COHORTS)[number];

/** Supported attribution models. */
export const ATTRIBUTION_MODELS = ["last_touch", "first_touch"] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

/** Cohort assignment — the denominator for attach rate and uplift. */
export const crossSellExposures = recommendationSchema.table(
  "cross_sell_exposures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** Tenant-defined experiment identifier. */
    campaignKey: varchar("campaign_key", { length: 64 }).notNull(),
    /** The customer/profile/account the assignment is for. */
    subjectId: uuid("subject_id").notNull(),
    /** One of COHORTS. */
    cohort: varchar("cohort", { length: 16 }).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => ({
    // A subject belongs to exactly one cohort per experiment. Without this a
    // re-assignment would silently double-count the denominator and depress the
    // measured attach rate.
    subjectUnique: unique("uq_cross_sell_exposures_subject").on(t.tenantId, t.campaignKey, t.subjectId),
    cohortIdx: index("idx_cross_sell_exposures_cohort").on(t.tenantId, t.campaignKey, t.cohort),
  }),
);

/** An outcome attributed back to the recommendation that produced it. */
export const crossSellAttributions = recommendationSchema.table(
  "cross_sell_attributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    campaignKey: varchar("campaign_key", { length: 64 }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    /**
     * The served recommendation credited with this outcome. NULL for a control
     * subject: a holdout converts without ever having been recommended anything,
     * and that conversion is the baseline uplift is measured against.
     */
    recommendationId: uuid("recommendation_id"),
    /** Tenant-defined outcome kind. */
    outcomeType: varchar("outcome_type", { length: 48 }).notNull(),
    /** External reference of the outcome (order no, policy no). Business key. */
    outcomeRef: varchar("outcome_ref", { length: 128 }).notNull(),
    /** Product actually taken, when known. */
    productId: uuid("product_id"),
    /**
     * MONEY — minor units as bigint. Serialised as a STRING in JSON, never a
     * number: above 2^53 a JSON number silently loses paise.
     */
    attributedAmountMinor: bigint("attributed_amount_minor", { mode: "bigint" }).notNull().default(0n),
    /** ISO 4217 code. */
    currency: varchar("currency", { length: 3 }).notNull(),
    /** One of COHORTS — denormalised from the exposure so a query needs no join. */
    cohort: varchar("cohort", { length: 16 }).notNull(),
    /** One of ATTRIBUTION_MODELS — which rule granted the credit. */
    attributionModel: varchar("attribution_model", { length: 32 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => ({
    // One attribution per outcome per experiment. This is what makes a redelivered
    // record-attribution command safe: the second insert violates the constraint
    // rather than inflating the numerator.
    outcomeUnique: unique("uq_cross_sell_attributions_outcome").on(
      t.tenantId,
      t.campaignKey,
      t.outcomeRef,
    ),
    campaignIdx: index("idx_cross_sell_attributions_campaign").on(
      t.tenantId,
      t.campaignKey,
      t.cohort,
    ),
  }),
);

export type CrossSellExposureRow = typeof crossSellExposures.$inferSelect;
export type CrossSellExposureInsert = typeof crossSellExposures.$inferInsert;
export type CrossSellAttributionRow = typeof crossSellAttributions.$inferSelect;
export type CrossSellAttributionInsert = typeof crossSellAttributions.$inferInsert;

export const schema = { crossSellExposures, crossSellAttributions };
