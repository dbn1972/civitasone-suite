import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text, boolean, date } from "drizzle-orm/pg-core";

const swmSchema = pgSchema("civitas_swm");

export const swmCollectionRequests = swmSchema.table("swm_collection_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  requestNumber: varchar("request_number", { length: 32 }).notNull(),
  requestedBy: uuid("requested_by").notNull(),
  wasteType: varchar("waste_type", { length: 32 }).notNull(),
  estimatedQuantity: text("estimated_quantity"),
  address: jsonb("address").$type<Record<string, unknown>>(),
  preferredDate: date("preferred_date"),
  preferredSlot: varchar("preferred_slot", { length: 24 }),
  status: varchar("status", { length: 24 }).notNull().default("requested"),
  vehicleId: text("vehicle_id"),
  feeMinor: integer("fee_minor"),
  feePaid: boolean("fee_paid").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const swmFieldTasks = swmSchema.table("swm_field_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  taskNumber: varchar("task_number", { length: 32 }).notNull(),
  routeId: text("route_id"),
  zoneId: text("zone_id"),
  assignedTo: uuid("assigned_to"),
  taskDate: date("task_date"),
  assetRefs: jsonb("asset_refs").$type<string[]>(),
  status: varchar("status", { length: 24 }).notNull().default("assigned"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  notes: text("notes"),
  photos: jsonb("photos").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type CollectionRequestRow = typeof swmCollectionRequests.$inferSelect;
export type CollectionRequestInsert = typeof swmCollectionRequests.$inferInsert;
export type FieldTaskRow = typeof swmFieldTasks.$inferSelect;
export type FieldTaskInsert = typeof swmFieldTasks.$inferInsert;
export const schema = { swmCollectionRequests, swmFieldTasks };
