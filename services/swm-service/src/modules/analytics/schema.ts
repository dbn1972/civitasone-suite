import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

const swmSchema = pgSchema("civitas_swm");

export const swmHotspots = swmSchema.table("swm_hotspots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  hotspotCode: varchar("hotspot_code", { length: 32 }).notNull(),
  location: jsonb("location").$type<Record<string, unknown>>(),
  category: varchar("category", { length: 32 }),
  complaintCount: integer("complaint_count").notNull().default(0),
  riskScore: integer("risk_score").notNull().default(0),
  status: varchar("status", { length: 24 }).notNull().default("identified"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type HotspotRow = typeof swmHotspots.$inferSelect;
export type HotspotInsert = typeof swmHotspots.$inferInsert;
export const schema = { swmHotspots };
