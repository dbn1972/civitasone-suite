import { pgSchema, uuid, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

/** Location shape stored in the jsonb location column. */
export interface SanitationLocation {
  lat: number;
  lng: number;
  ward: string;
  zone: string;
}

/** SAN-001 — citizen sanitation complaints. */
export const sanitationComplaints = helpdeskSchema.table("helpdesk_sanitation_complaints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintNumber: varchar("complaint_number", { length: 32 }).notNull(),
  reportedBy: uuid("reported_by").notNull(),
  location: jsonb("location").$type<SanitationLocation>().notNull(),
  facilityId: text("facility_id"),
  complaintType: varchar("complaint_type", { length: 32 }).notNull(),
  description: text("description"),
  photo: text("photo"),
  severity: varchar("severity", { length: 16 }).notNull().default("medium"),
  status: varchar("status", { length: 24 }).notNull().default("reported"),
  assignedTo: uuid("assigned_to"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),
  citizenFeedbackRating: integer("citizen_feedback_rating"),
  reopenCount: integer("reopen_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/** SAN-002 — field actions taken on a sanitation complaint. */
export const sanitationFieldActions = helpdeskSchema.table("helpdesk_sanitation_field_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintId: uuid("complaint_id").notNull(),
  actionType: varchar("action_type", { length: 24 }).notNull(),
  performedBy: uuid("performed_by").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  beforePhoto: text("before_photo"),
  afterPhoto: text("after_photo"),
  durationMinutes: integer("duration_minutes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ComplaintRow = typeof sanitationComplaints.$inferSelect;
export type ComplaintInsert = typeof sanitationComplaints.$inferInsert;
export type FieldActionRow = typeof sanitationFieldActions.$inferSelect;
export type FieldActionInsert = typeof sanitationFieldActions.$inferInsert;

export const schema = {
  sanitationComplaints,
  sanitationFieldActions,
};
