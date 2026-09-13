import { pgSchema, uuid, text, integer, bigint, char, varchar, numeric, timestamp, date } from "drizzle-orm/pg-core";

export const schemeSchema = pgSchema("scheme");

export const projectSchemes = schemeSchema.table("project_schemes", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  code:              text("code").notNull(),
  name:              text("name").notNull(),
  type:              varchar("type", { length: 24 }).notNull().default("css"),
  fundingPattern:    text("funding_pattern").notNull().default("100"),
  totalOutlayMinor:  bigint("total_outlay_minor", { mode: "bigint" }).notNull().default(0n),
  releasedMinor:     bigint("released_minor", { mode: "bigint" }).notNull().default(0n),
  utilisedMinor:     bigint("utilised_minor", { mode: "bigint" }).notNull().default(0n),
  sanctionRef:       text("sanction_ref"),
  // COMP-016 follow-up (migration 0021): 5 pure-display fields for
  // apps/web's /projects/schemes/[id] page. None of the five bears on any
  // scheme domain rule (allocation, disbursement, RAG, etc.) — the page
  // used to render them from a hardcoded catalogue because no column for
  // any of them existed anywhere in this schema; see PR #1240 (COMP-016),
  // which left "add columns vs. drop from the UI" as an explicitly open
  // product/schema decision rather than deciding it unilaterally.
  nodalOfficer:      text("nodal_officer"),
  department:        text("department"),
  beneficiaries:     integer("beneficiaries"),
  startDate:         date("start_date"),
  endDate:           date("end_date"),
  status:            varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export const projectSchemeComponents = schemeSchema.table("project_scheme_components", {
  id:               uuid("id").primaryKey().defaultRandom(),
  schemeId:         uuid("scheme_id").notNull(),
  tenantId:         uuid("tenant_id").notNull(),
  code:             text("code").notNull(),
  name:             text("name").notNull(),
  allocationMinor:  bigint("allocation_minor", { mode: "bigint" }).notNull().default(0n),
  releasedMinor:    bigint("released_minor", { mode: "bigint" }).notNull().default(0n),
  utilisedMinor:    bigint("utilised_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  weightPct:        numeric("weight_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  physicalPct:      numeric("physical_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const projectFundReleases = schemeSchema.table("project_fund_releases", {
  id:             uuid("id").primaryKey().defaultRandom(),
  schemeId:       uuid("scheme_id").notNull(),
  componentId:    uuid("component_id").notNull(),
  tenantId:       uuid("tenant_id").notNull(),
  releaseNo:      text("release_no").notNull(),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  status:         varchar("status", { length: 24 }).notNull().default("pending"),
  toEntity:       varchar("to_entity", { length: 32 }).notNull().default("agency"),
  pfmsRef:        text("pfms_ref"),
  sanctionedBy:   uuid("sanctioned_by"),
  sanctionedAt:   timestamp("sanctioned_at", { withTimezone: true }),
  disbursedAt:    timestamp("disbursed_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type SchemeRow          = typeof projectSchemes.$inferSelect;
export type SchemeInsert       = typeof projectSchemes.$inferInsert;
export type ComponentRow       = typeof projectSchemeComponents.$inferSelect;
export type ComponentInsert    = typeof projectSchemeComponents.$inferInsert;
export type FundReleaseRow     = typeof projectFundReleases.$inferSelect;
export type FundReleaseInsert  = typeof projectFundReleases.$inferInsert;

export const schema = { projectSchemes, projectSchemeComponents, projectFundReleases };
