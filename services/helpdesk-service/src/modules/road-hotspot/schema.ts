import { pgSchema, uuid, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

/** Location shape stored in the jsonb location column. */
export interface RoadHotspotLocation {
  lat: number;
  lng: number;
  ward: string;
  zone: string;
  road_name: string;
}

/** ROAD-004 — road infrastructure hotspots derived from complaint clustering. */
export const roadHotspots = helpdeskSchema.table("helpdesk_road_hotspots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  hotspotCode: varchar("hotspot_code", { length: 32 }).notNull(),
  location: jsonb("location").$type<RoadHotspotLocation>().notNull(),
  category: varchar("category", { length: 24 }).notNull(),
  complaintCount: integer("complaint_count").notNull().default(0),
  lastComplaintAt: timestamp("last_complaint_at", { withTimezone: true }),
  riskScore: integer("risk_score").notNull().default(0),
  status: varchar("status", { length: 32 }).notNull().default("identified"),
  maintenancePlanRef: text("maintenance_plan_ref"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/** Links between hotspots and originating helpdesk tickets. */
export const roadHotspotLinks = helpdeskSchema.table("helpdesk_road_hotspot_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  hotspotId: uuid("hotspot_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  linkedBy: uuid("linked_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type HotspotRow = typeof roadHotspots.$inferSelect;
export type HotspotInsert = typeof roadHotspots.$inferInsert;
export type HotspotLinkRow = typeof roadHotspotLinks.$inferSelect;
export type HotspotLinkInsert = typeof roadHotspotLinks.$inferInsert;

export const schema = {
  roadHotspots,
  roadHotspotLinks,
};
