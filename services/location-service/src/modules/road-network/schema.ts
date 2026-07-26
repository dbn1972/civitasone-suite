import { pgSchema, uuid, varchar, numeric, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

/** Road/route network tables (migration 0017). */
export const locationSchema = pgSchema("location");

export const roadSegments = locationSchema.table("road_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  roadClass: varchar("road_class", { length: 32 }).notNull(),
  fromNode: varchar("from_node", { length: 64 }).notNull(),
  toNode: varchar("to_node", { length: 64 }).notNull(),
  lengthMeters: numeric("length_meters", { precision: 12, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const routeNetworks = locationSchema.table("route_networks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 1000 }),
  segmentIds: jsonb("segment_ids").$type<string[]>().notNull().default([]),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RouteNetworkRow = typeof routeNetworks.$inferSelect;

export type RoadSegmentView = {
  id: string;
  tenantId: string;
  name: string;
  roadClass: string;
  fromNode: string;
  toNode: string;
  lengthMeters: number;
  status: string;
  coordinates: Array<[number, number]>;
  version: number;
};

export const schema = { roadSegments, routeNetworks };
