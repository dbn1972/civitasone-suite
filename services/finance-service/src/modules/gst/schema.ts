import { uuid, text, varchar, char, smallint, numeric, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { glSchema } from "../gl/schema.js";

// GLOBAL statutory reference masters (migration 0175). Like budget.finance_major_heads they carry NO tenant_id
// and NO RLS: the data is national, identical for every tenant. No consumer reads them yet (MSME M2/M3/M4).
// All seed values are placeholders flagged verify_by_ca = true (state codes excepted).

export const financeGstRateMaster = glSchema.table("finance_gst_rate_master", {
  id:            uuid("id").primaryKey().defaultRandom(),
  ratePct:       numeric("rate_pct", { precision: 5, scale: 2 }).notNull(),
  cessPct:       numeric("cess_pct", { precision: 6, scale: 2 }),
  hsnPrefix:     text("hsn_prefix").notNull().default(""),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo:   date("effective_to"),
  source:        text("source").notNull().default("placeholder"),
  notes:         text("notes"),
  verifyByCa:    boolean("verify_by_ca").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeHsnSacMaster = glSchema.table("finance_hsn_sac_master", {
  code:           text("code").primaryKey(),
  kind:           varchar("kind", { length: 3 }).notNull(),
  description:    text("description").notNull(),
  digits:         smallint("digits"),  // GENERATED ALWAYS (length(code)) in SQL -- read-only, never insert
  defaultRatePct: numeric("default_rate_pct", { precision: 5, scale: 2 }),
  isActive:       boolean("is_active").notNull().default(true),
  source:         text("source").notNull().default("placeholder"),
  notes:          text("notes"),
  verifyByCa:     boolean("verify_by_ca").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeGstStateCodes = glSchema.table("finance_gst_state_codes", {
  code:        char("code", { length: 2 }).primaryKey(),
  name:        text("name").notNull(),
  alphaCode:   varchar("alpha_code", { length: 2 }),
  kind:        varchar("kind", { length: 16 }).notNull().default("state"),
  isActive:    boolean("is_active").notNull().default(true),
  notes:       text("notes"),
  verifyByCa:  boolean("verify_by_ca").notNull().default(false),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
