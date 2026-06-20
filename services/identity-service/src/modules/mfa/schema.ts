import { pgSchema, uuid, varchar, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const mfaSchema = pgSchema("mfa");

export const mfaConfigs = mfaSchema.table("configs", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  userId:    uuid("user_id").notNull().unique(),
  method:    varchar("method", { length: 32 }).notNull().default("totp"),
  secret:    varchar("secret", { length: 512 }),
  enabled:   boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type MfaConfigRow    = typeof mfaConfigs.$inferSelect;
export type MfaConfigInsert = typeof mfaConfigs.$inferInsert;

export const mfaModuleSchema = { mfaConfigs };
