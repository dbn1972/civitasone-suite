import { pgSchema, uuid, varchar, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const rbacSchema = pgSchema("rbac");

export const roles = rbacSchema.table("roles", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  key:         varchar("key", { length: 64 }).notNull(),
  name:        varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 500 }),
  isSystem:    boolean("is_system").notNull().default(false),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const permissions = rbacSchema.table("permissions", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  key:         varchar("key", { length: 128 }).notNull(),
  name:        varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 500 }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const rolePermissions = rbacSchema.table("role_permissions", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  roleId:       uuid("role_id").notNull(),
  permissionId: uuid("permission_id").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
});

export const roleAssignments = rbacSchema.table("role_assignments", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  roleId:    uuid("role_id").notNull(),
  userId:    uuid("user_id").notNull(),
  status:    varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const roleAssignmentHistory = rbacSchema.table("role_assignment_history", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  roleId:     uuid("role_id").notNull(),
  userId:     uuid("user_id").notNull(),
  action:     varchar("action", { length: 24 }).notNull(),
  actorId:    uuid("actor_id").notNull(),
  reason:     varchar("reason", { length: 500 }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RoleRow            = typeof roles.$inferSelect;
export type RoleInsert         = typeof roles.$inferInsert;
export type PermissionRow      = typeof permissions.$inferSelect;
export type PermissionInsert   = typeof permissions.$inferInsert;
export type RolePermissionRow  = typeof rolePermissions.$inferSelect;
export type RoleAssignmentRow  = typeof roleAssignments.$inferSelect;

export const rbacModuleSchema = {
  roles, permissions, rolePermissions, roleAssignments, roleAssignmentHistory,
};
