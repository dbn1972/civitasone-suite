import { pgSchema, uuid, varchar, integer, bigint, date, timestamp, text } from "drizzle-orm/pg-core";

const marketSchema = pgSchema("market");

export const marketAllotments = marketSchema.table("market_allotments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  allotmentNumber: varchar("allotment_number", { length: 64 }).notNull().unique(),
  propertyId: uuid("property_id").notNull(),
  allotteeName: text("allottee_name").notNull(),
  allotteePhone: varchar("allottee_phone", { length: 20 }),
  allotteeAadhaar: varchar("allottee_aadhaar", { length: 12 }),
  allotmentType: varchar("allotment_type", { length: 32 }).notNull(),
  allotmentDate: date("allotment_date"),
  agreementStartDate: date("agreement_start_date"),
  agreementEndDate: date("agreement_end_date"),
  monthlyRentMinor: bigint("monthly_rent_minor", { mode: "bigint" }),
  securityDepositMinor: bigint("security_deposit_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  status: varchar("status", { length: 32 }).notNull().default("applied"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AllotmentRow = typeof marketAllotments.$inferSelect;
export type AllotmentInsert = typeof marketAllotments.$inferInsert;

export const schema = { marketAllotments };
