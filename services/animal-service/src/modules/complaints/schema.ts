import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const animalSchema = pgSchema("animal");

export const animalComplaints = animalSchema.table("animal_complaints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintNumber: varchar("complaint_number", { length: 64 }).notNull().unique(),
  reportedBy: uuid("reported_by").notNull(),
  location: jsonb("location").$type<{ lat?: number; lng?: number; address?: string; ward?: string; landmark?: string }>().notNull(),
  animalType: varchar("animal_type", { length: 32 }).notNull(),
  complaintType: varchar("complaint_type", { length: 32 }).notNull(),
  description: text("description"),
  photo: text("photo"),
  severity: varchar("severity", { length: 16 }).notNull().default("medium"),
  status: varchar("status", { length: 32 }).notNull().default("reported"),
  assignedTo: uuid("assigned_to"),
  assignedTeam: varchar("assigned_team", { length: 64 }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ComplaintRow = typeof animalComplaints.$inferSelect;
export type ComplaintInsert = typeof animalComplaints.$inferInsert;

export const schema = { animalComplaints };
