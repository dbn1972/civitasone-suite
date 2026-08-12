import { pgSchema, uuid, varchar, integer, bigint, timestamp, jsonb, text, char } from "drizzle-orm/pg-core";

export const roadcutSchema = pgSchema("roadcut");

export const roadcutApplications = roadcutSchema.table("roadcut_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationNumber: varchar("application_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  applicantName: varchar("applicant_name", { length: 256 }).notNull(),
  applicantOrg: varchar("applicant_org", { length: 256 }),
  purpose: varchar("purpose", { length: 64 }).notNull(),
  location: jsonb("location").$type<{
    latitude: number;
    longitude: number;
    address: string;
    ward?: string;
    zone?: string;
  }>().notNull(),
  roadType: varchar("road_type", { length: 32 }).notNull(),
  cuttingLength: text("cutting_length").notNull(),
  cuttingWidth: text("cutting_width").notNull(),
  cuttingDepth: text("cutting_depth").notNull(),
  documents: jsonb("documents").$type<Array<{ docType: string; fileId: string; uploadedAt: string }>>().notNull().default([]),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  depositMinor: bigint("deposit_minor", { mode: "bigint" }),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RoadcutApplicationRow = typeof roadcutApplications.$inferSelect;
export type RoadcutApplicationInsert = typeof roadcutApplications.$inferInsert;

export const schema = { roadcutApplications };
