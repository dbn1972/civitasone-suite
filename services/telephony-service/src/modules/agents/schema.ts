/**
 * agents module — call-centre agent presence registry in schema `telephony`.
 * Tracks which user is staffing which queue and their availability, used for
 * routing + the live agent-queue board.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("telephony");

/** Agent presence states. `available` agents can be routed new calls. */
export const AGENT_STATUSES = ["available", "busy", "wrap_up", "offline"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const agents = domainSchema.table("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  // The platform user backing this agent (no cross-service FK).
  userId: uuid("user_id").notNull(),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  queueId: uuid("queue_id"),
  status: varchar("status", { length: 16 }).notNull().default("offline"),
  extension: varchar("extension", { length: 16 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AgentRow = typeof agents.$inferSelect;
export type AgentInsert = typeof agents.$inferInsert;

export type AgentView = {
  id: string;
  tenantId: string;
  userId: string;
  displayName: string;
  queueId: string | null;
  status: AgentStatus;
  extension: string | null;
  version: number;
};

export const schema = { agents };
