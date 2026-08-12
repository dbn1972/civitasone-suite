import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

const animalSchema = pgSchema("animal");

export const animalOperations = animalSchema.table("animal_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintId: uuid("complaint_id").notNull(),
  operationType: varchar("operation_type", { length: 32 }).notNull(),
  performedBy: uuid("performed_by").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull(),
  animalTagId: text("animal_tag_id"),
  location: jsonb("location").$type<{ lat?: number; lng?: number; address?: string }>(),
  notes: text("notes"),
  beforePhoto: text("before_photo"),
  afterPhoto: text("after_photo"),
  shelterRef: text("shelter_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type OperationRow = typeof animalOperations.$inferSelect;
export type OperationInsert = typeof animalOperations.$inferInsert;

export const schema = { animalOperations };
