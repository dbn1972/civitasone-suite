import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const eventSchema = pgSchema("event");

export const eventPermits = eventSchema.table("event_permits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  permitNumber: varchar("permit_number", { length: 64 }).notNull().unique(),
  applicationId: uuid("application_id").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("issued"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  conditions: jsonb("conditions").$type<Record<string, unknown>>(),
  verificationCode: varchar("verification_code", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type EventPermitRow = typeof eventPermits.$inferSelect;
export type EventPermitInsert = typeof eventPermits.$inferInsert;

export const schema = { eventPermits };
