import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const appointments = crmSchema.table("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  serviceType: varchar("service_type", { length: 64 }).notNull(),
  locationId: uuid("location_id"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  status: varchar("status", { length: 16 }).notNull().default("booked"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppointmentRow = typeof appointments.$inferSelect;

export const schema = { appointments };
