import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text, boolean, date } from "drizzle-orm/pg-core";

export const sewerageSchema = pgSchema("civitas_sewerage");

export const sewerageApplications = sewerageSchema.table("sewerage_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationNumber: varchar("application_number", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("submitted"),
  propertyRef: text("property_ref"),
  waterConnectionRef: text("water_connection_ref"),
  connectionClass: varchar("connection_class", { length: 24 }).notNull(),
  siteDetails: jsonb("site_details").$type<Record<string, unknown>>(),
  feeMinor: integer("fee_minor"),
  feePaid: boolean("fee_paid").notNull().default(false),
  feasibilityReport: jsonb("feasibility_report").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const sewerageConnections = sewerageSchema.table("sewerage_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  connectionNumber: varchar("connection_number", { length: 32 }).notNull(),
  applicationId: uuid("application_id").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  activationDate: date("activation_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ApplicationRow = typeof sewerageApplications.$inferSelect;
export type ApplicationInsert = typeof sewerageApplications.$inferInsert;
export type ConnectionRow = typeof sewerageConnections.$inferSelect;
export type ConnectionInsert = typeof sewerageConnections.$inferInsert;

export const schema = { sewerageApplications, sewerageConnections };
