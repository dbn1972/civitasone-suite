import { pgSchema, uuid, varchar, boolean, integer, timestamp, text } from "drizzle-orm/pg-core";

export const sessionsSchema = pgSchema("sessions");

export const sessions = sessionsSchema.table("sessions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  userId:    uuid("user_id").notNull(),
  ip:        varchar("ip", { length: 45 }).notNull(),
  device:    varchar("device", { length: 256 }),
  mfaMethod: varchar("mfa_method", { length: 32 }),
  trusted:   boolean("trusted").notNull().default(false),
  status:       varchar("status", { length: 24 }).notNull().default("active"),
  userEmail:    text("user_email").notNull().default(""),
  userName:     text("user_name"),
  userAgent:    varchar("user_agent", { length: 512 }),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt:    timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type SessionRow    = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;

export const sessionsModuleSchema = { sessions };
