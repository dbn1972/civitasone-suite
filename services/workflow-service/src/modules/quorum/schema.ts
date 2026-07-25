import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/** CAP-026 — a committee/quorum decision over a fixed membership. */
export const committeeDecisions = domainSchema.table("committee_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  instanceId: uuid("instance_id"),
  taskId: uuid("task_id"),
  nodeKey: varchar("node_key", { length: 64 }),
  subject: varchar("subject", { length: 256 }).notNull(),
  rule: varchar("rule", { length: 16 }).notNull().default("majority"),
  threshold: integer("threshold"),
  totalMembers: integer("total_members").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("open"),
  outcome: varchar("outcome", { length: 16 }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** CAP-026 — a single member's vote on a committee decision. */
export const committeeVotes = domainSchema.table("committee_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  decisionId: uuid("decision_id").notNull(),
  voterId: uuid("voter_id").notNull(),
  vote: varchar("vote", { length: 16 }).notNull(),
  reason: varchar("reason", { length: 512 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommitteeDecisionRow = typeof committeeDecisions.$inferSelect;
export type CommitteeVoteRow = typeof committeeVotes.$inferSelect;

export const schema = { committeeDecisions, committeeVotes };
