import { pgSchema, uuid, varchar, integer, date, timestamp, text } from "drizzle-orm/pg-core";

const crematoriumSchema = pgSchema("crematorium");

export const crematoriumServiceRegister = crematoriumSchema.table("crematorium_service_register", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  serviceDate: date("service_date").notNull(),
  slotNumber: text("slot_number"),
  serviceType: varchar("service_type", { length: 32 }).notNull(),
  performedBy: uuid("performed_by").notNull(),
  notes: text("notes"),
  completionCertificateRef: text("completion_certificate_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ServiceRegisterRow = typeof crematoriumServiceRegister.$inferSelect;
export type ServiceRegisterInsert = typeof crematoriumServiceRegister.$inferInsert;

export const schema = { crematoriumServiceRegister };
