/**
 * INT-12 — bounce events, suppression list and per-tenant suppression settings.
 *
 * PII: `recipient` on both bounce_events and suppression_list is an email
 * address or phone number and is therefore stored via `encryptedText()`
 * (AES-256-GCM at rest). `recipientHash` is the keyed HMAC blind index — plain
 * text, NOT reversible — which exists purely so suppression lookups and the
 * per-tenant unique constraint work over the encrypted column.
 */
import { pgSchema, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const bouncesSchema = pgSchema("bounces");

export const bounceEvents = bouncesSchema.table("bounce_events", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  deliveryId:     uuid("delivery_id"),
  recipient:      encryptedText("recipient").notNull(),      // PII — encrypted
  recipientHash:  text("recipient_hash").notNull(),          // HMAC blind index
  channel:        varchar("channel", { length: 32 }).notNull().default("email"),
  smtpCode:       varchar("smtp_code", { length: 32 }),
  reason:         text("reason"),
  classification: varchar("classification", { length: 16 }).notNull(),
  occurredAt:     timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const suppressionList = bouncesSchema.table("suppression_list", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  recipient:     encryptedText("recipient").notNull(),       // PII — encrypted
  recipientHash: text("recipient_hash").notNull(),           // HMAC blind index
  channel:       varchar("channel", { length: 32 }).notNull().default("email"),
  reason:        varchar("reason", { length: 40 }).notNull(),
  source:        varchar("source", { length: 24 }).notNull().default("bounce"),
  softBounceCount: integer("soft_bounce_count").notNull().default(0),
  suppressedAt:  timestamp("suppressed_at", { withTimezone: true }).notNull().defaultNow(),
  releasedAt:    timestamp("released_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

/**
 * Spam/abuse complaints relayed by an ESP feedback loop (RFC 5965 ARF).
 *
 * Deliberately NOT stored in `bounce_events`: that table's `classification`
 * column is constrained to hard/soft/unknown and carries the invariant "unknown
 * must never suppress". A complaint has no classification and no threshold — it
 * always suppresses — so `feedback_type` here is diagnostic only.
 */
export const complaintEvents = bouncesSchema.table("complaint_events", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  deliveryId:    uuid("delivery_id"),
  recipient:     encryptedText("recipient").notNull(),        // PII — encrypted
  recipientHash: text("recipient_hash").notNull(),            // HMAC blind index
  channel:       varchar("channel", { length: 32 }).notNull().default("email"),
  feedbackType:  varchar("feedback_type", { length: 32 }).notNull().default("abuse"),
  reason:        text("reason"),
  occurredAt:    timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const suppressionSettings = bouncesSchema.table("suppression_settings", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  softBounceThreshold: integer("soft_bounce_threshold").notNull().default(5),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export type BounceEventRow = typeof bounceEvents.$inferSelect;
export type BounceEventInsert = typeof bounceEvents.$inferInsert;
export type ComplaintEventRow = typeof complaintEvents.$inferSelect;
export type ComplaintEventInsert = typeof complaintEvents.$inferInsert;
export type SuppressionRow = typeof suppressionList.$inferSelect;
export type SuppressionInsert = typeof suppressionList.$inferInsert;
export type SuppressionSettingsRow = typeof suppressionSettings.$inferSelect;

export const bouncesModuleSchema = { bounceEvents, complaintEvents, suppressionList, suppressionSettings };
