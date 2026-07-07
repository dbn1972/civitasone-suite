import { pgSchema, uuid, text, integer, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const renewalsSchema = pgSchema("renewals");

export const contractRenewals = renewalsSchema.table("contract_renewals", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  contractId:         uuid("contract_id").notNull(),
  expiryDate:         date("expiry_date").notNull(),
  advanceNoticeDays:  integer("advance_notice_days").notNull().default(30),
  status:             varchar("status", { length: 24 }).notNull().default("active"), // "active" | "renewed" | "expired" | "cancelled"
  renewedAt:          timestamp("renewed_at", { withTimezone: true }),
  renewedBy:          uuid("renewed_by"),
  notifiedAt:         timestamp("notified_at", { withTimezone: true }),
  finalReminderAt:    timestamp("final_reminder_at", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

export type RenewalRow = typeof contractRenewals.$inferSelect;
export type RenewalInsert = typeof contractRenewals.$inferInsert;

export const schema = { contractRenewals };
