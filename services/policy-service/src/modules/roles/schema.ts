import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const rolesSchema = pgSchema("roles");

export const roles = rolesSchema.table("roles", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  name:        varchar("name", { length: 128 }).notNull(),
  description: varchar("description", { length: 500 }),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const permissions = rolesSchema.table("permissions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  roleId:    uuid("role_id").notNull(),
  resource:  varchar("resource", { length: 128 }).notNull(),
  action:    varchar("action", { length: 64 }).notNull(),
  effect:    varchar("effect", { length: 8 }).notNull().default("allow"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type RoleRow       = typeof roles.$inferSelect;
export type RoleInsert    = typeof roles.$inferInsert;
export type PermRow       = typeof permissions.$inferSelect;
export type PermInsert    = typeof permissions.$inferInsert;

export const rolesModuleSchema = { roles, permissions };
