/**
 * price-books module — Drizzle schema (QP-002).
 * Price books scoped by segment, currency and geography, plus per-product entries.
 *
 * MONEY RULE: `amountMinor` is a bigint of MINOR UNITS (paise). It is never a
 * number and never a float. Routes serialise it with `.toString()` so a value
 * above 2^53 round-trips exactly through JSON.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";

export const catalogueSchema = pgSchema("catalogue");

/** CHECK allowlist from migration 0006. */
export const PRICE_BOOK_STATUSES = ["draft", "active", "archived"] as const;
export type PriceBookStatus = (typeof PRICE_BOOK_STATUSES)[number];

export const priceBooks = catalogueSchema.table("price_books", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  segment: varchar("segment", { length: 64 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  /** Free-form selector, e.g. { circleCode: "KA", regionCode: "BLR" }. */
  geography: jsonb("geography").$type<Record<string, unknown>>().notNull().default({}),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PriceBookRow = typeof priceBooks.$inferSelect;
export type PriceBookInsert = typeof priceBooks.$inferInsert;

export const priceBookEntries = catalogueSchema.table("price_book_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  priceBookId: uuid("price_book_id").notNull(),
  productId: uuid("product_id").notNull(),
  /** MONEY RULE: bigint minor units (paise). Never a number, never a float. */
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PriceBookEntryRow = typeof priceBookEntries.$inferSelect;
export type PriceBookEntryInsert = typeof priceBookEntries.$inferInsert;

export const schema = { priceBooks, priceBookEntries };
