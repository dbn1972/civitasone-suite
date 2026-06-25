import { pgSchema, uuid, text, integer, bigint, char, varchar, timestamp } from "drizzle-orm/pg-core";

export const counselSchema = pgSchema("counsel");

export const legalCounselBriefs = counselSchema.table("legal_counsel_briefs", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  caseId:       uuid("case_id").notNull(),
  hearingId:    uuid("hearing_id"),
  counselName:  text("counsel_name").notNull(),
  counselType:  varchar("counsel_type", { length: 24 }).notNull().default("advocate"),
  briefSummary: text("brief_summary").notNull(),
  feeMinor:     bigint("fee_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  status:       varchar("status", { length: 24 }).notNull().default("assigned"),
  assignedAt:   timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type CounselBriefRow = typeof legalCounselBriefs.$inferSelect;
export type CounselBriefInsert = typeof legalCounselBriefs.$inferInsert;
export const schema = { legalCounselBriefs };
