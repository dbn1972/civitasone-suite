import { pgSchema, uuid, varchar, integer, bigint, boolean, date, timestamp, text } from "drizzle-orm/pg-core";

const crematoriumSchema = pgSchema("crematorium");

export const crematoriumBookings = crematoriumSchema.table("crematorium_bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bookingNumber: varchar("booking_number", { length: 64 }).notNull().unique(),
  facilityId: uuid("facility_id").notNull(),
  applicantName: text("applicant_name").notNull(),
  applicantPhone: varchar("applicant_phone", { length: 20 }).notNull(),
  applicantRelation: varchar("applicant_relation", { length: 32 }),
  deceasedName: text("deceased_name").notNull(),
  deceasedAge: integer("deceased_age"),
  deceasedGender: varchar("deceased_gender", { length: 16 }),
  deathCertificateRef: text("death_certificate_ref"),
  serviceType: varchar("service_type", { length: 32 }).notNull(),
  requestedDate: date("requested_date").notNull(),
  requestedSlot: varchar("requested_slot", { length: 32 }),
  status: varchar("status", { length: 32 }).notNull().default("requested"),
  slotNumber: text("slot_number"),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  feePaid: boolean("fee_paid").notNull().default(false),
  paymentRef: text("payment_ref"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BookingRow = typeof crematoriumBookings.$inferSelect;
export type BookingInsert = typeof crematoriumBookings.$inferInsert;

export const schema = { crematoriumBookings };
