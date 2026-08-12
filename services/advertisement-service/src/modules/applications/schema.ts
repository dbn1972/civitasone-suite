import { pgSchema, uuid, varchar, integer, bigint, boolean, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const advApplicationsSchema = pgSchema("adv_applications");

export const advApplications = advApplicationsSchema.table("adv_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationNumber: varchar("application_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  advertiserName: text("advertiser_name").notNull(),
  advertiserOrg: text("advertiser_org").notNull(),
  advertisementType: varchar("advertisement_type", { length: 32 }).notNull(),
  location: jsonb("location").$type<{
    lat?: number;
    lng?: number;
    address: string;
    ward?: string;
    zone?: string;
  }>().notNull(),
  dimensions: jsonb("dimensions").$type<{
    widthFt: number;
    heightFt: number;
    areaInSqFt: number;
  }>().notNull(),
  structuralDetails: jsonb("structural_details").$type<{
    material?: string;
    foundation?: string;
    height?: number;
    illumination?: string;
  }>(),
  creative: text("creative"),
  documents: jsonb("documents").$type<Array<{
    docType: string;
    fileId: string;
    uploadedAt: string;
  }>>().notNull().default([]),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  feePaid: boolean("fee_paid").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AdvApplicationRow = typeof advApplications.$inferSelect;
export type AdvApplicationInsert = typeof advApplications.$inferInsert;

export const schema = { advApplications };
