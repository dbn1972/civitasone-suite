import { pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const planningSchema = pgSchema("planning");

/**
 * SVC-041 Annual procurement planning — plan header (yearly demand plan).
 * Maker-checker: draft → pending (submit) → approved / rejected.
 */
export const procurementPlans = planningSchema.table("procurement_plans", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  planNo:              text("plan_no").notNull(),
  planYear:            integer("plan_year").notNull(),
  title:               text("title").notNull(),
  department:          text("department").notNull(),
  status:              varchar("status", { length: 24 }).notNull().default("draft"),
  totalEstimatedMinor: bigint("total_estimated_minor", { mode: "bigint" }).notNull().default(0n),
  currency:            char("currency", { length: 3 }).notNull().default("INR"),
  notes:               text("notes"),
  submittedBy:         uuid("submitted_by"),
  submittedAt:         timestamp("submitted_at", { withTimezone: true }),
  approvedBy:          uuid("approved_by"),
  approvedAt:          timestamp("approved_at", { withTimezone: true }),
  rejectedReason:      text("rejected_reason"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

/**
 * Plan line — a category/method/budget-line/timeline/package packet of aggregated
 * demand, optionally sourced from approved indents and later linked to a tender.
 */
export const procurementPlanLines = planningSchema.table("procurement_plan_lines", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  planId:              uuid("plan_id").notNull(),
  tenantId:            uuid("tenant_id").notNull(),
  itemCode:            text("item_code").notNull(),
  description:         text("description").notNull(),
  aggregatedQty:       integer("aggregated_qty").notNull().default(0),
  uom:                 varchar("uom", { length: 32 }).notNull().default("nos"),
  procurementCategory: varchar("procurement_category", { length: 24 }).notNull().default("goods"),
  procurementMethod:   varchar("procurement_method", { length: 24 }).notNull().default("gem"),
  budgetLine:          text("budget_line"),
  estimatedValueMinor: bigint("estimated_value_minor", { mode: "bigint" }).notNull().default(0n),
  currency:            char("currency", { length: 3 }).notNull().default("INR"),
  timelineQuarter:     varchar("timeline_quarter", { length: 8 }),
  packageGroup:        varchar("package_group", { length: 64 }),
  sourceIndentIds:     jsonb("source_indent_ids").notNull().default([]),
  tenderId:            uuid("tender_id"),
  tenderLinkedAt:      timestamp("tender_linked_at", { withTimezone: true }),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export type PlanRow        = typeof procurementPlans.$inferSelect;
export type PlanInsert     = typeof procurementPlans.$inferInsert;
export type PlanLineRow    = typeof procurementPlanLines.$inferSelect;
export type PlanLineInsert = typeof procurementPlanLines.$inferInsert;

export const schema = { procurementPlans, procurementPlanLines };
