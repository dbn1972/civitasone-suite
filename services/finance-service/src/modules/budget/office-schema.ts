import { pgSchema, uuid, text, integer, boolean, varchar, timestamp } from "drizzle-orm/pg-core";

const budgetSchema = pgSchema("budget");

/**
 * Minimal tenant-scoped office directory (migrations/0083). The ids on
 * allocation distributions (from_office_id / to_office_id) are opaque uuids with
 * no FK; this table gives them names so fund-release screens can show an office
 * rather than "Unknown office".
 */
export const financeOffices = budgetSchema.table("finance_offices", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  code:      varchar("code", { length: 32 }).notNull(),
  name:      text("name").notNull(),
  isActive:  boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:   integer("version").notNull().default(1),
});

export type OfficeRow = typeof financeOffices.$inferSelect;
export const officeSchema = { financeOffices };
