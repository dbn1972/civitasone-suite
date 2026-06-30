import {
  pgSchema, uuid, text, integer, boolean, timestamp,
} from "drizzle-orm/pg-core";

export const filesSchema = pgSchema("files");

/**
 * Government organisation hierarchy (CSMOP) — Ministry → Department → Wing →
 * Division → Section → Desk, as a self-referential tree. Files/operators may be
 * attached to an org unit so marking lists and channels of submission are
 * hierarchy-derived rather than free-text (gap analysis R1).
 */
export const estabOrgUnit = filesSchema.table("estab_org_unit", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  code:           text("code").notNull(),
  name:           text("name").notNull(),
  type:           text("type").notNull(), // ministry|department|wing|division|section|desk
  parentId:       uuid("parent_id"),
  headOperatorId: uuid("head_operator_id"),
  active:         boolean("active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type OrgUnitRow = typeof estabOrgUnit.$inferSelect;
export type OrgUnitInsert = typeof estabOrgUnit.$inferInsert;

export const schema = { estabOrgUnit };
