import { pgSchema, uuid, varchar, numeric, jsonb, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/** CAP-033 — a directed link between two cases (see domain.ts for semantics). */
export const caseLinks = domainSchema.table("case_links", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  fromCaseId: uuid("from_case_id").notNull(),
  toCaseId:   uuid("to_case_id").notNull(),
  linkType:   varchar("link_type", { length: 24 }).notNull(),
  allocation: numeric("allocation", { precision: 6, scale: 3 }),
  reason:     varchar("reason", { length: 500 }),
  metadata:   jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
});

export type CaseLinkRow = typeof caseLinks.$inferSelect;

export const schema = { caseLinks };
