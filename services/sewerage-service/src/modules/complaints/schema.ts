import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

const sewerageSchema = pgSchema("civitas_sewerage");

export const sewerageComplaints = sewerageSchema.table("sewerage_complaints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintNumber: varchar("complaint_number", { length: 32 }).notNull(),
  reportedBy: uuid("reported_by").notNull(),
  location: jsonb("location").$type<Record<string, unknown>>(),
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

export const sewerageFieldRecords = sewerageSchema.table("sewerage_field_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintId: uuid("complaint_id"),
  bookingId: uuid("booking_id"),
  assetRef: text("asset_ref"),
  manholeRef: text("manhole_ref"),
  workPerformed: text("work_performed"),
  beforePhoto: text("before_photo"),
  afterPhoto: text("after_photo"),
  closedBy: uuid("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ComplaintRow = typeof sewerageComplaints.$inferSelect;
export type ComplaintInsert = typeof sewerageComplaints.$inferInsert;
export type FieldRecordRow = typeof sewerageFieldRecords.$inferSelect;
export type FieldRecordInsert = typeof sewerageFieldRecords.$inferInsert;
export const schema = { sewerageComplaints, sewerageFieldRecords };
