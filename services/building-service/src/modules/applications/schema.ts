import { pgSchema, uuid, varchar, integer, bigint, boolean, timestamp, jsonb, text, numeric } from "drizzle-orm/pg-core";

export const buildingSchema = pgSchema("building");

export const buildingApplications = buildingSchema.table("building_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationNumber: varchar("application_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  siteAddress: jsonb("site_address").$type<{
    line1: string;
    line2?: string;
    city: string;
    pin: string;
    ward?: string;
    zone?: string;
    surveyNumber?: string;
  }>().notNull(),
  plotArea: numeric("plot_area", { precision: 12, scale: 2 }),
  builtUpArea: numeric("built_up_area", { precision: 12, scale: 2 }),
  proposedFloors: integer("proposed_floors"),
  fsiRequested: numeric("fsi_requested", { precision: 6, scale: 3 }),
  farComputed: numeric("far_computed", { precision: 6, scale: 3 }),
  architectName: varchar("architect_name", { length: 256 }),
  architectLicenceNo: varchar("architect_licence_no", { length: 64 }),
  structuralEngineer: varchar("structural_engineer", { length: 256 }),
  documents: jsonb("documents").$type<Array<{
    docType: string;
    fileId: string;
    uploadedAt: string;
  }>>().notNull().default([]),
  drawings: jsonb("drawings").$type<Array<{
    drawingType: string;
    fileId: string;
    versionNumber: number;
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

export type BuildingApplicationRow = typeof buildingApplications.$inferSelect;
export type BuildingApplicationInsert = typeof buildingApplications.$inferInsert;

export const schema = { buildingApplications };
