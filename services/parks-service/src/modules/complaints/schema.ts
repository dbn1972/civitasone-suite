import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

const parksSchema = pgSchema("civitas_parks");

export const parksComplaints = parksSchema.table("parks_complaints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintNumber: varchar("complaint_number", { length: 32 }).notNull(),
  reportedBy: uuid("reported_by").notNull(),
  location: jsonb("location").$type<Record<string, unknown>>(),
  parkAssetRef: text("park_asset_ref"),
  complaintType: varchar("complaint_type", { length: 32 }).notNull(),
  description: text("description"),
  photo: text("photo"),
  severity: varchar("severity", { length: 16 }),
  status: varchar("status", { length: 24 }).notNull().default("reported"),
  assignedTo: uuid("assigned_to"),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ComplaintRow = typeof parksComplaints.$inferSelect;
export type ComplaintInsert = typeof parksComplaints.$inferInsert;
export const schema = { parksComplaints };
