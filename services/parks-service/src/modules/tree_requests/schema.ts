import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";
import { boolean } from "drizzle-orm/pg-core";

const parksSchema = pgSchema("civitas_parks");

export const parksTreeRequests = parksSchema.table("parks_tree_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  requestNumber: varchar("request_number", { length: 32 }).notNull(),
  requestedBy: uuid("requested_by").notNull(),
  requestType: varchar("request_type", { length: 24 }).notNull(),
  location: jsonb("location").$type<Record<string, unknown>>(),
  treeSpecies: text("tree_species"),
  reason: text("reason"),
  photos: jsonb("photos").$type<string[]>(),
  status: varchar("status", { length: 24 }).notNull().default("submitted"),
  inspectorId: uuid("inspector_id"),
  inspectionReport: jsonb("inspection_report").$type<Record<string, unknown>>(),
  approvedBy: uuid("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TreeRequestRow = typeof parksTreeRequests.$inferSelect;
export type TreeRequestInsert = typeof parksTreeRequests.$inferInsert;
export const schema = { parksTreeRequests };
