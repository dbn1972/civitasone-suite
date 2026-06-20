import { pgSchema, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";

export const bindingsSchema = pgSchema("bindings");

export const roleBindings = bindingsSchema.table("bindings", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  userId:    uuid("user_id").notNull(),
  roleId:    uuid("role_id").notNull(),
  status:    varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const breakglass = bindingsSchema.table("breakglass", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  requesterId:  uuid("requester_id").notNull(),
  reason:       text("reason").notNull(),
  scope:        varchar("scope", { length: 256 }).notNull(),
  grantedUntil: timestamp("granted_until", { withTimezone: true }).notNull(),
  status:       varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type BindingRow     = typeof roleBindings.$inferSelect;
export type BindingInsert  = typeof roleBindings.$inferInsert;
export type BreakglassRow  = typeof breakglass.$inferSelect;
export type BreakglassInsert = typeof breakglass.$inferInsert;

export const bindingsModuleSchema = { roleBindings, breakglass };
