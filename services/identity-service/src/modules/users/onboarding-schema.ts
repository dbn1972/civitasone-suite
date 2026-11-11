import { pgSchema, uuid, varchar, boolean, timestamp } from "drizzle-orm/pg-core";

const usersSchema = pgSchema("users");

/** Migration 0034: per-tenant switch for the usable-logins create flow. No row = off (today's behaviour). */
export const tenantOnboardingSettings = usersSchema.table("tenant_onboarding_settings", {
  tenantId:     uuid("tenant_id").primaryKey(),
  usableLogins: boolean("usable_logins").notNull().default(false),
  passwordMode: varchar("password_mode", { length: 8 }).notNull().default("link"),
  updatedBy:    uuid("updated_by").notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Migration 0034: single-use set-password tokens. Only the SHA-256 of the secret is stored. */
export const passwordSetupTokens = usersSchema.table("password_setup_tokens", {
  id:         uuid("id").primaryKey(),
  tenantId:   uuid("tenant_id").notNull(),
  userId:     uuid("user_id").notNull(),
  tokenHash:  varchar("token_hash", { length: 64 }).notNull(),
  createdBy:  uuid("created_by").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt:  timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  revokedAt:  timestamp("revoked_at", { withTimezone: true }),
});

export type OnboardingSettingsRow = typeof tenantOnboardingSettings.$inferSelect;
export const onboardingModuleSchema = { tenantOnboardingSettings, passwordSetupTokens };
