import { pgSchema, uuid, text, integer, varchar, bigint, timestamp } from "drizzle-orm/pg-core";

export const approvalsSchema = pgSchema("approvals");

export const approvalLevels = approvalsSchema.table("approval_levels", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  minValuePaise: bigint("min_value_paise", { mode: "bigint" }).notNull(),
  requiredRole:  varchar("required_role", { length: 100 }).notNull(),
  label:         varchar("label", { length: 200 }).notNull().default(""),
  ordinal:       integer("ordinal").notNull().default(1),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type ApprovalLevelRow = typeof approvalLevels.$inferSelect;
export type ApprovalLevelInsert = typeof approvalLevels.$inferInsert;

export const schema = { approvalLevels };
