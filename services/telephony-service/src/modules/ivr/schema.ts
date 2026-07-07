/**
 * ivr module — IVR hit events table in schema `telephony`.
 *
 * Captures DTMF keypresses during IVR menu navigation. Each hit records:
 * - menuKey: the IVR menu node identifier (e.g., "main_menu", "billing_options")
 * - digit: the DTMF key(s) pressed (0-9, *, #)
 * - timestamp: when the hit occurred (UTC)
 * - ordinal: position in the sequence (1-based, max 50 per call)
 *
 * Max 50 IVR hits per call enforced at the application layer.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("telephony");

export const ivrHits = domainSchema.table("ivr_hits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  callId: uuid("call_id").notNull(),
  menuKey: varchar("menu_key", { length: 64 }).notNull(),
  digit: varchar("digit", { length: 8 }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  ordinal: integer("ordinal").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type IvrHitRow = typeof ivrHits.$inferSelect;
export type IvrHitInsert = typeof ivrHits.$inferInsert;

export type IvrHitView = {
  id: string;
  tenantId: string;
  callId: string;
  menuKey: string;
  digit: string;
  timestamp: string;
  ordinal: number;
};

export const schema = { ivrHits };
