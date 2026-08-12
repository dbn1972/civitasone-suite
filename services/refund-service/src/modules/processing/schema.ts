import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

export const refundSchema = pgSchema("refund");

export const refundApprovals = refundSchema.table("refund_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  requestId: uuid("request_id").notNull(),
  approvalLevel: integer("approval_level").notNull(),
  approverId: uuid("approver_id").notNull(),
  decision: varchar("decision", { length: 32 }).notNull(),
  remarks: text("remarks"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RefundApprovalRow = typeof refundApprovals.$inferSelect;
export type RefundApprovalInsert = typeof refundApprovals.$inferInsert;

export const schema = { refundApprovals };
