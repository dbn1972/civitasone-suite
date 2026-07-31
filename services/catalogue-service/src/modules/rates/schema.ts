/**
 * rates module — Drizzle schema. Rate references tied to products with effective dating.
 */
import { pgSchema, uuid, varchar, integer, timestamp, date, bigint } from "drizzle-orm/pg-core";

export const catalogueSchema = pgSchema("catalogue");

export const rates = catalogueSchema.table("rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  effectiveDate: date("effective_date").notNull(),
  /** Rate value stored in minor units (paise/cents) as bigint for precision. */
  rateValue: bigint("rate_value", { mode: "bigint" }).notNull(),
  source: varchar("source", { length: 128 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RateRow = typeof rates.$inferSelect;
export type RateInsert = typeof rates.$inferInsert;

export const schema = { rates };
