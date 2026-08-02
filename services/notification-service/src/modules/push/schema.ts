/**
 * MT-006 — push subscriptions + in-app message inbox.
 *
 * PII / secrets:
 *   - `deviceToken` is a bearer credential for pushing to a device. Stored via
 *     `encryptedText()` (AES-256-GCM at rest) and never returned or logged.
 *   - `endpoint` (Web Push) embeds the same capability, so it is encrypted too.
 *   - `tokenHash` is the keyed HMAC blind index — plain text, irreversible —
 *     which exists so the per-user unique constraint and de-dup work over the
 *     encrypted column.
 */
import { pgSchema, uuid, varchar, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const pushSchema = pgSchema("push");

export const pushSubscriptions = pushSchema.table("push_subscriptions", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  userId:      uuid("user_id").notNull(),
  platform:    varchar("platform", { length: 16 }).notNull(),
  deviceToken: encryptedText("device_token").notNull(), // SECRET — encrypted
  endpoint:    encryptedText("endpoint"),               // SECRET — encrypted, web only
  tokenHash:   text("token_hash").notNull(),            // HMAC blind index
  userAgent:   varchar("user_agent", { length: 400 }),
  enabled:     boolean("enabled").notNull().default(true),
  revokedAt:   timestamp("revoked_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const inAppMessages = pushSchema.table("in_app_messages", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  userId:     uuid("user_id").notNull(),
  title:      varchar("title", { length: 200 }).notNull(),
  body:       text("body").notNull(),
  /** info | warning | action_required */
  severity:   varchar("severity", { length: 24 }).notNull().default("info"),
  actionUrl:  varchar("action_url", { length: 2048 }),
  metadata:   jsonb("metadata").$type<Record<string, string>>(),
  readAt:     timestamp("read_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type PushSubscriptionInsert = typeof pushSubscriptions.$inferInsert;
export type InAppMessageRow = typeof inAppMessages.$inferSelect;
export type InAppMessageInsert = typeof inAppMessages.$inferInsert;

export const pushModuleSchema = { pushSubscriptions, inAppMessages };
