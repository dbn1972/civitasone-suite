import { pgSchema, uuid, varchar, text, bigint, timestamp } from "drizzle-orm/pg-core";

export const webauthnSchema = pgSchema("webauthn");

export const webauthnCredentials = webauthnSchema.table("credentials", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  // Owner. Always set from the authenticated request context (ctx.actorId) on
  // insert, and always the predicate a delete is scoped by — never taken from
  // a client-supplied field.
  userId:        uuid("user_id").notNull(),
  credentialId:  varchar("credential_id", { length: 1024 }).notNull(),
  publicKey:     text("public_key").notNull(),
  signCount:     bigint("sign_count", { mode: "number" }).notNull().default(0),
  deviceName:    varchar("device_name", { length: 200 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt:    timestamp("last_used_at", { withTimezone: true }),
});

export type WebauthnCredentialRow    = typeof webauthnCredentials.$inferSelect;
export type WebauthnCredentialInsert = typeof webauthnCredentials.$inferInsert;

export const webauthnModuleSchema = { webauthnCredentials };
