import { pgSchema, uuid, varchar, numeric, integer, timestamp } from "drizzle-orm/pg-core";

/** location.infrastructure_assets — created in 0013, tenant-isolated in 0014. */
export const locationSchema = pgSchema("location");

export const infrastructureAssets = locationSchema.table("infrastructure_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  lat: numeric("lat", { precision: 10, scale: 7 }).notNull(),
  lng: numeric("lng", { precision: 10, scale: 7 }).notNull(),
  capacity: varchar("capacity", { length: 128 }),
  conditionScore: integer("condition_score"),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  lastInspectionAt: timestamp("last_inspection_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type InfrastructureAssetRow = typeof infrastructureAssets.$inferSelect;
export type InfrastructureAssetInsert = typeof infrastructureAssets.$inferInsert;

export type InfrastructureAssetView = {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  capacity: string | null;
  conditionScore: number | null;
  status: string;
  version: number;
};

export const schema = { infrastructureAssets };
