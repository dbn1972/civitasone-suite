/**
 * rates module — Drizzle schema. Rate references tied to products with effective dating.
 */
import { pgSchema, uuid, varchar, integer, timestamp, date, bigint } from "drizzle-orm/pg-core";

export const catalogueSchema = pgSchema("catalogue");

export const rates = catalogueSchema.table("rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  /** Start of effective period (inclusive). */
  effectiveDate: date("effective_date").notNull(),
  /** End of effective period (inclusive). Null = open-ended / still current. */
  effectiveTo: date("effective_to"),
  /** Rate value stored in minor units (paise/cents) as bigint for precision. */
  rateValue: bigint("rate_value", { mode: "bigint" }).notNull(),
  source: varchar("source", { length: 128 }).notNull(),
  /**
   * PC-005: rate tables as external masters. When `sourceSystem` is set the rate
   * is mastered outside CivitasOne and this row is a synchronised replica.
   * Added by migration 0005.
   */
  sourceSystem: varchar("source_system", { length: 128 }),
  externalId: varchar("external_id", { length: 200 }),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RateRow = typeof rates.$inferSelect;
export type RateInsert = typeof rates.$inferInsert;

export const schema = { rates };
