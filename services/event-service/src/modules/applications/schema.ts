import { pgSchema, uuid, varchar, integer, bigint, boolean, timestamp, jsonb, date } from "drizzle-orm/pg-core";

export const eventSchema = pgSchema("event");

export const eventApplications = eventSchema.table("event_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationNumber: varchar("application_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  organiserName: varchar("organiser_name", { length: 256 }).notNull(),
  organiserOrg: varchar("organiser_org", { length: 256 }),
  organiserPhone: varchar("organiser_phone", { length: 15 }).notNull(),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  venueName: varchar("venue_name", { length: 256 }).notNull(),
  venueAddress: jsonb("venue_address").$type<{
    line1: string;
    line2?: string;
    city: string;
    pin: string;
    ward?: string;
    zone?: string;
  }>().notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  expectedAttendance: integer("expected_attendance").notNull(),
  temporaryStructures: jsonb("temporary_structures").$type<Array<{
    type: string;
    count: number;
    areaSqft?: number;
  }>>(),
  soundPermission: boolean("sound_permission").notNull().default(false),
  documents: jsonb("documents").$type<Array<{ docType: string; fileId: string; uploadedAt: string }>>().notNull().default([]),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  depositMinor: bigint("deposit_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type EventApplicationRow = typeof eventApplications.$inferSelect;
export type EventApplicationInsert = typeof eventApplications.$inferInsert;

export const schema = { eventApplications };
