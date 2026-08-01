import { pgSchema, uuid, integer, timestamp, text, boolean, numeric } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("ai_agent");

/**
 * AG-004 per-turn interaction quality. One row per (conversation, turn) — the
 * UNIQUE constraint is what makes "score 100% of interactions" idempotent: a
 * re-score updates in place instead of double-counting.
 *
 * The numeric columns are read as STRINGS (drizzle default for numeric) and are
 * never cast to number on the way out — see quality-domain.ts.
 */
export const interactionQuality = domainSchema.table("interaction_quality", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  turnId: uuid("turn_id").notNull(),
  relevance: numeric("relevance", { precision: 5, scale: 4 }),
  coherence: numeric("coherence", { precision: 5, scale: 4 }),
  safety: numeric("safety", { precision: 5, scale: 4 }),
  overall: numeric("overall", { precision: 5, scale: 4 }),
  flagged: boolean("flagged").notNull().default(false),
  flagReason: text("flag_reason"),
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type InteractionQualityRow = typeof interactionQuality.$inferSelect;
export type InteractionQualityInsert = typeof interactionQuality.$inferInsert;

export const schema = { interactionQuality };
