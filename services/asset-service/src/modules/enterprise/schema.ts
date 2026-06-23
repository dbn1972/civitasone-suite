import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

export const enterpriseSchema = pgSchema("enterprise");

export const projectAuc = enterpriseSchema.table("project_auc", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  projectCode:      text("project_code").notNull(),
  name:             text("name").notNull(),
  wbsRef:           text("wbs_ref"),
  accumulatedMinor: bigint("accumulated_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  status:           varchar("status", { length: 24 }).notNull().default("under_construction"),
  assetId:          uuid("asset_id"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const assetLeases = enterpriseSchema.table("asset_leases", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  leaseNo:         text("lease_no").notNull(),
  lessorName:      text("lessor_name").notNull(),
  rouCostMinor:    bigint("rou_cost_minor", { mode: "bigint" }).notNull().default(0n),
  liabilityMinor:  bigint("liability_minor", { mode: "bigint" }).notNull().default(0n),
  leaseStart:      date("lease_start").notNull(),
  leaseEnd:        date("lease_end").notNull(),
  assetId:         uuid("asset_id"),
  status:          varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const assetImpairments = enterpriseSchema.table("asset_impairments", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  assetId:         uuid("asset_id").notNull(),
  eventType:       varchar("event_type", { length: 16 }).notNull(),
  amountMinor:     bigint("amount_minor", { mode: "bigint" }).notNull(),
  bookValueBefore: bigint("book_value_before", { mode: "bigint" }).notNull(),
  bookValueAfter:  bigint("book_value_after", { mode: "bigint" }).notNull(),
  reason:          text("reason"),
  eventDate:       date("event_date").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

export const functionalLocations = enterpriseSchema.table("functional_locations", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  code:      text("code").notNull(),
  name:      text("name").notNull(),
  parentId:  uuid("parent_id"),
  orgUnit:   varchar("org_unit", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export const spareParts = enterpriseSchema.table("spare_parts", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  workOrderId:  uuid("work_order_id").notNull(),
  partCode:     text("part_code").notNull(),
  description:  text("description"),
  qty:          integer("qty").notNull().default(1),
  costMinor:    bigint("cost_minor", { mode: "bigint" }).notNull().default(0n),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
});

export const schema = { projectAuc, assetLeases, assetImpairments, functionalLocations, spareParts };
