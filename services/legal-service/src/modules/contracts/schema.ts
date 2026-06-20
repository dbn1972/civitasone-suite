import { pgSchema, uuid, text, integer, bigint, char, varchar, timestamp } from "drizzle-orm/pg-core";

export const contractsSchema = pgSchema("contracts");

export const legalContractReviews = contractsSchema.table("legal_contract_reviews", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  contractRef:  text("contract_ref").notNull(),
  subject:      text("subject").notNull(),
  valueMinor:   bigint("value_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  status:       varchar("status", { length: 24 }).notNull().default("pending"),
  clearedAt:    timestamp("cleared_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const legalClearances = contractsSchema.table("legal_clearances", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  reviewId:       uuid("review_id").notNull(),
  clearanceType:  varchar("clearance_type", { length: 32 }).notNull(),
  notes:          text("notes"),
  clearedAt:      timestamp("cleared_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type ReviewRow = typeof legalContractReviews.$inferSelect;
export const schema = { legalContractReviews, legalClearances };
