import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const buildingSchema = pgSchema("building");

export const buildingPermits = buildingSchema.table("building_permits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  permitNumber: varchar("permit_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  conditions: jsonb("conditions").$type<Array<{ condition: string; category: string }>>(),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  verificationCode: varchar("verification_code", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BuildingPermitRow = typeof buildingPermits.$inferSelect;
export type BuildingPermitInsert = typeof buildingPermits.$inferInsert;

export const schema = { buildingPermits };
