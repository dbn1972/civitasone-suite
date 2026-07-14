import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const hierarchySchema = pgSchema("hierarchy");

// `type` is a varchar validated against hierarchy.unit_types (migration 0012) —
// an INSERT-only lookup — rather than a rigid PG enum, so state-specific levels
// can be added without a DDL deploy.
export const administrativeUnits = hierarchySchema.table("administrative_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 32 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  parentId: uuid("parent_id"),
  population: integer("population"),
  areaKm2: integer("area_km2"),
  pinCodes: jsonb("pin_codes").$type<string[]>(),
  lgdCode: varchar("lgd_code", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AdministrativeUnitRow = typeof administrativeUnits.$inferSelect;
export type AdministrativeUnitInsert = typeof administrativeUnits.$inferInsert;

export type AdministrativeUnitView = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  population: number | null;
  areaKm2: number | null;
  pinCodes: string[] | null;
  lgdCode: string | null;
  version: number;
};

export const schema = { administrativeUnits };
