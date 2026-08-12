import { pgSchema, uuid, varchar, date, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

const fireInspections = pgSchema("fire_inspections");

export const fireInspectionsTable = fireInspections.table("fire_inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  inspectorId: uuid("inspector_id").notNull(),
  scheduledDate: date("scheduled_date").notNull(),
  inspectedAt: timestamp("inspected_at", { withTimezone: true }),
  findings: jsonb("findings"),
  deficiencies: jsonb("deficiencies"),
  status: varchar("status", { length: 32 }).notNull().default("scheduled"),
  recommendation: varchar("recommendation", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type FireInspectionRow = typeof fireInspectionsTable.$inferSelect;
export type FireInspectionInsert = typeof fireInspectionsTable.$inferInsert;

export const schema = { fireInspections: fireInspectionsTable };
