import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const tenantSchema = pgSchema("tenant");

export const orgUnits = tenantSchema.table("org_units", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  parentId:      uuid("parent_id"),
  name:          varchar("name", { length: 200 }).notNull(),
  type:          varchar("type", { length: 32 }).notNull(),
  level:         integer("level").notNull().default(1),
  headUserId:    uuid("head_user_id"),
  code:          varchar("code", { length: 32 }),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo:   timestamp("effective_to", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type OrgUnitRow = typeof orgUnits.$inferSelect;
export type OrgUnitInsert = typeof orgUnits.$inferInsert;
export const orgHierarchySchema = { orgUnits };
