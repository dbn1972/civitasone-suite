import { pgSchema, uuid, varchar, integer, timestamp, jsonb, date } from "drizzle-orm/pg-core";

export const roadcutSchema = pgSchema("roadcut");

export const roadcutInspections = roadcutSchema.table("roadcut_inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  permitId: uuid("permit_id").notNull(),
  inspectionType: varchar("inspection_type", { length: 32 }).notNull(),
  inspectorId: uuid("inspector_id").notNull(),
  scheduledDate: date("scheduled_date").notNull(),
  inspectedAt: timestamp("inspected_at", { withTimezone: true }),
  findings: jsonb("findings").$type<Record<string, unknown>>(),
  photos: jsonb("photos").$type<Array<{ fileId: string; caption?: string }>>(),
  status: varchar("status", { length: 32 }).notNull().default("scheduled"),
  restorationQuality: varchar("restoration_quality", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type InspectionRow = typeof roadcutInspections.$inferSelect;
export type InspectionInsert = typeof roadcutInspections.$inferInsert;

export const schema = { roadcutInspections };
