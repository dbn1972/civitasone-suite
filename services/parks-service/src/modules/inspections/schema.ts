import { pgSchema, uuid, varchar, integer, timestamp, jsonb, boolean, date } from "drizzle-orm/pg-core";

const parksSchema = pgSchema("civitas_parks");

export const parksInspections = parksSchema.table("parks_inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintId: uuid("complaint_id"),
  treeRequestId: uuid("tree_request_id"),
  inspectorId: uuid("inspector_id").notNull(),
  scheduledDate: date("scheduled_date"),
  inspectedAt: timestamp("inspected_at", { withTimezone: true }),
  findings: jsonb("findings").$type<Record<string, unknown>>(),
  photos: jsonb("photos").$type<string[]>(),
  workOrderRequired: boolean("work_order_required").notNull().default(false),
  status: varchar("status", { length: 24 }).notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type InspectionRow = typeof parksInspections.$inferSelect;
export type InspectionInsert = typeof parksInspections.$inferInsert;
export const schema = { parksInspections };
