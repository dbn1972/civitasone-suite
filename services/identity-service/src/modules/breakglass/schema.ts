import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const breakglassSchema = pgSchema("breakglass");

export const grants = breakglassSchema.table("grants", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  userId:      uuid("user_id").notNull(),
  reason:      varchar("reason", { length: 500 }).notNull(),
  scope:       varchar("scope", { length: 128 }).notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  grantedBy:   uuid("granted_by").notNull(),
  closedBy:    uuid("closed_by"),
  closeReason: varchar("close_reason", { length: 500 }),
  grantedAt:   timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt:   timestamp("expires_at", { withTimezone: true }).notNull(),
  closedAt:    timestamp("closed_at", { withTimezone: true }),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:     integer("version").notNull().default(1),
});

export type GrantRow    = typeof grants.$inferSelect;
export type GrantInsert = typeof grants.$inferInsert;

export const breakglassModuleSchema = { grants };
