import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

export const lifecycleSchema = pgSchema("lifecycle");

export const hrmsTransfers = lifecycleSchema.table("hrms_transfers", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  employeeId:   uuid("employee_id").notNull(),
  fromDeptId:   uuid("from_dept_id").notNull(),
  toDeptId:     uuid("to_dept_id").notNull(),
  fromDesigId:  uuid("from_desig_id"),
  toDesigId:    uuid("to_desig_id"),
  effectiveDate: date("effective_date").notNull(),
  orderRef:     text("order_ref"),
  fromStation:  varchar("from_station", { length: 128 }),
  toStation:    varchar("to_station", { length: 128 }),
  orderNo:      varchar("order_no", { length: 64 }),
  orderDate:    date("order_date"),
  relievedDate: date("relieved_date"),
  joinedDate:   date("joined_date"),
  status:       varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type TransferRow = typeof hrmsTransfers.$inferSelect;

export const hrmsPromotions = lifecycleSchema.table("hrms_promotions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  fromDesigId:   uuid("from_desig_id").notNull(),
  toDesigId:     uuid("to_desig_id").notNull(),
  effectiveDate: date("effective_date").notNull(),
  orderRef:      text("order_ref"),
  newBasicMinor: bigint("new_basic_minor", { mode: "bigint" }),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  status:        varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type PromotionRow = typeof hrmsPromotions.$inferSelect;

export const hrmsSeparations = lifecycleSchema.table("hrms_separations", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  employeeId:       uuid("employee_id").notNull(),
  separationType:   varchar("separation_type", { length: 32 }).notNull(),
  effectiveDate:    date("effective_date").notNull(),
  lastWorkingDate:  date("last_working_date"),
  encashmentDays:   integer("encashment_days").notNull().default(0),
  encashmentMinor:  bigint("encashment_minor", { mode: "bigint" }).notNull().default(0n),
  gratuityMinor:    bigint("gratuity_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  remarks:          text("remarks"),
  status:           varchar("status", { length: 24 }).notNull().default("initiated"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export type SeparationRow = typeof hrmsSeparations.$inferSelect;

export const schema = { hrmsTransfers, hrmsPromotions, hrmsSeparations };
