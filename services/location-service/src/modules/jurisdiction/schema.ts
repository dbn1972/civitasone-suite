import { pgSchema, uuid, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const jurisdictionSchema = pgSchema("jurisdiction");

export const jurisdictions = jurisdictionSchema.table("jurisdictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  officeId: uuid("office_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  level: varchar("level", { length: 24 }).notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type JurisdictionRow = typeof jurisdictions.$inferSelect;
export type JurisdictionInsert = typeof jurisdictions.$inferInsert;

export type JurisdictionView = {
  id: string;
  tenantId: string;
  officeId: string;
  unitId: string;
  level: string;
  isPrimary: boolean;
  version: number;
};

export const schema = { jurisdictions };
