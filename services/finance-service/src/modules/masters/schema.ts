import { pgSchema, uuid, text, varchar, boolean, timestamp } from "drizzle-orm/pg-core";

export const paymentsSchema = pgSchema("payments");

export const financePao = paymentsSchema.table("finance_pao", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  paoCode:   varchar("pao_code", { length: 12 }).notNull(),
  name:      text("name").notNull(),
  ministry:  text("ministry"),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeDdo = paymentsSchema.table("finance_ddo", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  ddoCode:   varchar("ddo_code", { length: 12 }).notNull(),
  name:      text("name").notNull(),
  paoCode:   varchar("pao_code", { length: 12 }),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaoRow = typeof financePao.$inferSelect;
export type DdoRow = typeof financeDdo.$inferSelect;

export const schema = { financePao, financeDdo };
