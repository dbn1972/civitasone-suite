import { pgSchema, uuid, varchar, integer, text, timestamp, date } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("knowledge");

export const policyDocuments = domainSchema.table("policy_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  docType: varchar("doc_type", { length: 16 }).notNull().default("sop"),
  referenceNo: varchar("reference_no", { length: 64 }),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull().default(""),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  authorId: uuid("author_id").notNull(),
  reviewerId: uuid("reviewer_id"),
  approverId: uuid("approver_id"),
  effectiveDate: date("effective_date"),
  reviewDueDate: date("review_due_date"),
  supersedesId: uuid("supersedes_id"),
  version: integer("version").notNull().default(1),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const policyAcknowledgements = domainSchema.table("policy_acknowledgements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  policyId: uuid("policy_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  note: varchar("note", { length: 500 }),
});

export type PolicyRow = typeof policyDocuments.$inferSelect;
export type PolicyInsert = typeof policyDocuments.$inferInsert;
export type AckRow = typeof policyAcknowledgements.$inferSelect;
export type AckInsert = typeof policyAcknowledgements.$inferInsert;

export type PolicyView = {
  id: string;
  tenantId: string;
  docType: string;
  referenceNo: string | null;
  title: string;
  body: string;
  status: string;
  authorId: string;
  reviewerId: string | null;
  approverId: string | null;
  effectiveDate: string | null;
  reviewDueDate: string | null;
  supersedesId: string | null;
  version: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const schema = { policyDocuments, policyAcknowledgements };
