/**
 * PSU v1 slice C (migrations 0188-0189): drizzle mirror of the two NEW tenant tables in the gl schema -- the shareholding / cap-table
 * register and the dividend register. Both RLS-scoped (FORCE); money is paise (bigint). There is no db/schema.sql or Alembic in
 * finance-service: migrations + this file are the source of truth.
 */
import { uuid, text, varchar, bigint, date, integer, timestamp } from "drizzle-orm/pg-core";
import { glSchema } from "../gl/schema.js";

export const HOLDER_CATEGORIES = ["president_of_india", "other_govt", "govt_body", "public_sector_entity", "institution", "public", "employee", "other"] as const;
export type HolderCategory = (typeof HOLDER_CATEGORIES)[number];
export const SHARE_CLASSES = ["equity", "preference"] as const;
export type ShareClass = (typeof SHARE_CLASSES)[number];
export const DIVIDEND_TYPES = ["interim", "final"] as const;
export type DividendType = (typeof DIVIDEND_TYPES)[number];

export const psuShareholdings = glSchema.table("psu_shareholdings", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  holderName:     text("holder_name").notNull(),
  category:       varchar("category", { length: 24 }).$type<HolderCategory>().notNull(),
  shareClass:     varchar("share_class", { length: 12 }).$type<ShareClass>().notNull().default("equity"),
  shares:         bigint("shares", { mode: "bigint" }).notNull(),
  faceValueMinor: bigint("face_value_minor", { mode: "bigint" }).notNull(),
  folio:          varchar("folio", { length: 32 }),
  status:         varchar("status", { length: 10 }).$type<"active" | "retired">().notNull().default("active"),
  remarks:        text("remarks"),
  createdBy:      uuid("created_by").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:      uuid("updated_by").notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:        integer("version").notNull().default(1),
});
export type ShareholdingRow = typeof psuShareholdings.$inferSelect;

export const psuDividends = glSchema.table("psu_dividends", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  fyCode:            varchar("fy_code", { length: 7 }).notNull(),
  dividendType:      varchar("dividend_type", { length: 8 }).$type<DividendType>().notNull(),
  declaredOn:        date("declared_on").notNull(),
  resolutionRef:     text("resolution_ref").notNull(),
  perShareMinor:     bigint("per_share_minor", { mode: "bigint" }).notNull(),
  equityShares:      bigint("equity_shares", { mode: "bigint" }).notNull(),
  govtShares:        bigint("govt_shares", { mode: "bigint" }).notNull().default(0n),
  amountMinor:       bigint("amount_minor", { mode: "bigint" }).notNull(),
  govtAmountMinor:   bigint("govt_amount_minor", { mode: "bigint" }).notNull().default(0n),
  status:            varchar("status", { length: 10 }).$type<"declared" | "paid">().notNull().default("declared"),
  declaredJournalId: uuid("declared_journal_id").notNull(),
  paidOn:            date("paid_on"),
  paidJournalId:     uuid("paid_journal_id"),
  createdBy:         uuid("created_by").notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:         uuid("updated_by").notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:           integer("version").notNull().default(1),
});
export type DividendRow = typeof psuDividends.$inferSelect;

export const schema = { psuShareholdings, psuDividends };
