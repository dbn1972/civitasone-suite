import { pgSchema, uuid, varchar, integer, bigint, date, text, timestamp } from "drizzle-orm/pg-core";

export const outsourcedSchema = pgSchema("outsourced");

/** Vendor-supplied workforce contract (GAP-HR-OUTSOURCED-01). Money in paise. */
export const hrmsOutsourcedContracts = outsourcedSchema.table("hrms_outsourced_contracts", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  vendorName:         varchar("vendor_name", { length: 200 }).notNull(),
  serviceCategory:    varchar("service_category", { length: 120 }).notNull(),
  contractRef:        varchar("contract_ref", { length: 64 }),
  headcount:          integer("headcount").notNull(),
  contractStart:      date("contract_start").notNull(),
  contractEnd:        date("contract_end").notNull(),
  contractValueMinor: bigint("contract_value_minor", { mode: "bigint" }).notNull().default(0n),
  status:             varchar("status", { length: 16 }).notNull().default("active"),
  remarks:            text("remarks"),
  version:            integer("version").notNull().default(1),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
});

export type OutsourcedContractRow = typeof hrmsOutsourcedContracts.$inferSelect;
export type OutsourcedContractInsert = typeof hrmsOutsourcedContracts.$inferInsert;
