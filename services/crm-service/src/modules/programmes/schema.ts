/**
 * programmes module — Drizzle schema for crm.programmes and crm.programme_metrics (G12).
 *
 * `accountId` and `contractId` are opaque references. `accountId` happens to live in the
 * same PG schema, but this module never joins to it: it records what the caller asserted
 * so the module stays independently extractable. `contractId` points into
 * contract-service and is never dereferenced here at all (database-per-service).
 *
 * Money lives in `valueMinor` as a bigint of minor units and is serialised as a STRING in
 * every view, so a revenue figure above 2^53 cannot lose precision on the wire.
 */
import {
  pgSchema,
  uuid,
  varchar,
  integer,
  bigint,
  char,
  numeric,
  timestamp,
  date,
  text,
  jsonb,
} from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

/**
 * Coverage the programme is executed over. Shape is tenant-defined; both keys optional.
 * `| undefined` is spelled out because `exactOptionalPropertyTypes` is on and callers
 * legitimately build this from optional request fields.
 */
export type CoverageScope = {
  regions?: string[] | undefined;
  districts?: string[] | undefined;
};

export const programmes = crmSchema.table("programmes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programmeCode: varchar("programme_code", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  accountId: uuid("account_id").notNull(),
  contractId: uuid("contract_id"),
  productLine: varchar("product_line", { length: 64 }).notNull().default("government"),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  sponsoringDepartment: varchar("sponsoring_department", { length: 200 }),
  coverageScope: jsonb("coverage_scope").$type<CoverageScope>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const programmeMetrics = crmSchema.table("programme_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programmeId: uuid("programme_id").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  metricKey: varchar("metric_key", { length: 64 }).notNull(),
  metricKind: varchar("metric_kind", { length: 8 }).notNull(),
  valueMinor: bigint("value_minor", { mode: "bigint" }),
  currency: char("currency", { length: 3 }),
  /**
   * `mode: "string"` deliberately: numeric(20,6) exceeds what a JS number represents
   * faithfully, and a coverage ratio that silently rounds is a reporting defect.
   */
  valueNumeric: numeric("value_numeric", { precision: 20, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ProgrammeRow = typeof programmes.$inferSelect;
export type ProgrammeInsert = typeof programmes.$inferInsert;
export type ProgrammeMetricRow = typeof programmeMetrics.$inferSelect;
export type ProgrammeMetricInsert = typeof programmeMetrics.$inferInsert;

export type ProgrammeView = {
  id: string;
  tenantId: string;
  programmeCode: string;
  name: string;
  description: string | null;
  accountId: string;
  contractId: string | null;
  productLine: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sponsoringDepartment: string | null;
  coverageScope: CoverageScope;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ProgrammeMetricView = {
  id: string;
  tenantId: string;
  programmeId: string;
  periodStart: string;
  periodEnd: string;
  metricKey: string;
  metricKind: string;
  /** Minor units as a STRING when the metric is monetary, otherwise null. */
  valueMinor: string | null;
  currency: string | null;
  /** Decimal string when the metric is a count or ratio, otherwise null. */
  valueNumeric: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export const schema = { programmes, programmeMetrics };
