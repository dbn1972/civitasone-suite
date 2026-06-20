import { pgSchema, uuid, varchar, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const usersSchema = pgSchema("users");

export const users = usersSchema.table("users", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  email:      varchar("email", { length: 254 }).notNull(),
  name:       varchar("name", { length: 200 }).notNull(),
  empCode:    varchar("emp_code", { length: 64 }),
  status:     varchar("status", { length: 24 }).notNull().default("active"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const serviceAccounts = usersSchema.table("service_accounts", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      varchar("name", { length: 200 }).notNull(),
  scopes:    jsonb("scopes").$type<string[]>().notNull().default([]),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  status:    varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type UserRow    = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;

export const usersModuleSchema = { users, serviceAccounts };
