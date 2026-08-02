/**
 * CR-MKT-06 — keyword routing rules + the auto-responses they produced.
 * F.5      — conversation handoff state + audit trail.
 *
 * Tables live in the existing `notification` schema alongside inbox_correlations
 * so the inbox module keeps owning one PG schema.
 *
 * PII: `inbound_auto_responses.sender` is a phone number or email address and is
 * therefore stored via `encryptedText()`. `senderHash` is the keyed HMAC blind
 * index used for per-sender rate/history lookups without decryption.
 */
import { pgSchema, uuid, varchar, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const inboxSchema = pgSchema("notification");

export const keywordRules = inboxSchema.table("keyword_rules", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  keyword:      varchar("keyword", { length: 120 }).notNull(),
  /** exact | prefix | contains */
  matchType:    varchar("match_type", { length: 16 }).notNull().default("exact"),
  /** null = applies to every inbound channel */
  channel:      varchar("channel", { length: 24 }),
  /** lower number = higher precedence */
  priority:     integer("priority").notNull().default(100),
  responseBody: text("response_body"),
  action:       varchar("action", { length: 40 }),
  enabled:      boolean("enabled").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const inboundAutoResponses = inboxSchema.table("inbound_auto_responses", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  ruleId:     uuid("rule_id").notNull(),
  channel:    varchar("channel", { length: 24 }).notNull(),
  sender:     encryptedText("sender").notNull(),   // PII — encrypted
  senderHash: text("sender_hash").notNull(),       // HMAC blind index
  /** none | reply | action | reply_and_action */
  outcome:    varchar("outcome", { length: 24 }).notNull(),
  action:     varchar("action", { length: 40 }),
  respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const conversationHandoffs = inboxSchema.table("conversation_handoffs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  conversationId:  uuid("conversation_id").notNull(),
  /** ai_handling | paused | human_handling | closed */
  state:           varchar("state", { length: 24 }).notNull().default("ai_handling"),
  assignedAgentId: uuid("assigned_agent_id"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const handoffAudit = inboxSchema.table("handoff_audit", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  fromState:      varchar("from_state", { length: 24 }).notNull(),
  toState:        varchar("to_state", { length: 24 }).notNull(),
  action:         varchar("action", { length: 24 }).notNull(),
  agentId:        uuid("agent_id"),
  reason:         text("reason"),
  occurredAt:     timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type KeywordRuleRow = typeof keywordRules.$inferSelect;
export type KeywordRuleInsert = typeof keywordRules.$inferInsert;
export type InboundAutoResponseRow = typeof inboundAutoResponses.$inferSelect;
export type InboundAutoResponseInsert = typeof inboundAutoResponses.$inferInsert;
export type ConversationHandoffRow = typeof conversationHandoffs.$inferSelect;
export type ConversationHandoffInsert = typeof conversationHandoffs.$inferInsert;
export type HandoffAuditRow = typeof handoffAudit.$inferSelect;
export type HandoffAuditInsert = typeof handoffAudit.$inferInsert;

export const inboxExtensionsSchema = {
  keywordRules,
  inboundAutoResponses,
  conversationHandoffs,
  handoffAudit,
};
