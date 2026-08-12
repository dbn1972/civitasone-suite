import { pgSchema, uuid, varchar, integer, bigint, boolean, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const tradeSchema = pgSchema("trade");

export const tradeApplications = tradeSchema.table("trade_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationNumber: varchar("application_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  businessName: varchar("business_name", { length: 256 }).notNull(),
  tradeCategory: varchar("trade_category", { length: 64 }).notNull(),
  subCategory: varchar("sub_category", { length: 64 }),
  ownerName: varchar("owner_name", { length: 256 }).notNull(),
  premisesAddress: jsonb("premises_address").$type<{
    line1: string;
    line2?: string;
    city: string;
    pin: string;
    ward?: string;
    zone?: string;
  }>().notNull(),
  areaInSqft: integer("area_in_sqft"),
  employeeCount: integer("employee_count"),
  documents: jsonb("documents").$type<Array<{
    docType: string;
    fileId: string;
    uploadedAt: string;
  }>>().notNull().default([]),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  feeCurrency: varchar("fee_currency", { length: 3 }).notNull().default("INR"),
  feePaid: boolean("fee_paid").notNull().default(false),
  feeTransactionId: varchar("fee_transaction_id", { length: 128 }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TradeApplicationRow = typeof tradeApplications.$inferSelect;
export type TradeApplicationInsert = typeof tradeApplications.$inferInsert;

export const schema = { tradeApplications };
