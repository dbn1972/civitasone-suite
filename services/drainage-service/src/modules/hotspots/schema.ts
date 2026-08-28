import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

const drainageSchema = pgSchema("civitas_drainage");

export const drainageHotspots = drainageSchema.table("drainage_hotspots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  // .unique() added in this pass, same reasoning as complaints.complaintNumber.
  hotspotCode: varchar("hotspot_code", { length: 32 }).notNull().unique(),
  location: jsonb("location").$type<Record<string, unknown>>(),
  category: varchar("category", { length: 32 }),
  complaintCount: integer("complaint_count").notNull().default(0),
  lastComplaintAt: timestamp("last_complaint_at", { withTimezone: true }),
  riskScore: integer("risk_score").notNull().default(0),
  status: varchar("status", { length: 32 }).notNull().default("identified"),
  maintenancePlanRef: text("maintenance_plan_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type HotspotRow = typeof drainageHotspots.$inferSelect;
export type HotspotInsert = typeof drainageHotspots.$inferInsert;
export const schema = { drainageHotspots };
