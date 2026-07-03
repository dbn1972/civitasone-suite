import { pgSchema, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const pfmsSchema = pgSchema("payments");

export const financePfmsConfig = pfmsSchema.table("finance_pfms_config", {
  tenantId:    uuid("tenant_id").primaryKey(),
  agencyCode:  varchar("agency_code", { length: 12 }).notNull(),
  defaultDdo:  varchar("default_ddo", { length: 12 }),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { financePfmsConfig };
