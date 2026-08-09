import { pgSchema, uuid, varchar, integer, bigint, boolean, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const shopSchema = pgSchema("shop");

export const applications = shopSchema.table("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationNumber: varchar("application_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  applicantId: uuid("applicant_id").notNull(),
  establishmentName: varchar("establishment_name", { length: 256 }).notNull(),
  establishmentType: varchar("establishment_type", { length: 64 }).notNull(),
  ownerName: varchar("owner_name", { length: 256 }).notNull(),
  ownerType: varchar("owner_type", { length: 32 }).notNull(),
  premisesAddress: jsonb("premises_address").$type<{
    line1: string;
    line2?: string;
    city: string;
    pin: string;
    ward?: string;
    zone?: string;
  }>().notNull(),
  premisesPropertyId: uuid("premises_property_id"),
  activityDescription: text("activity_description"),
  activityCategory: varchar("activity_category", { length: 64 }).notNull(),
  employeeCount: integer("employee_count"),
  capacityDetails: jsonb("capacity_details").$type<{
    seating?: number;
    areaSqft?: number;
    floors?: number;
  }>(),
  documents: jsonb("documents").$type<Array<{
    docType: string;
    fileId: string;
    uploadedAt: string;
  }>>().notNull().default([]),
  feeAmountMinor: bigint("fee_amount_minor", { mode: "bigint" }),
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

export type ApplicationRow = typeof applications.$inferSelect;
export type ApplicationInsert = typeof applications.$inferInsert;

export const schema = { applications };
