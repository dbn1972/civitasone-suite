import { pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const settlementsSchema = pgSchema("settlements");

export const legalSettlements = settlementsSchema.table("legal_settlements", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  caseId:       uuid("case_id"),
  settlementNo: text("settlement_no").notNull(),
  amountMinor:  bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  status:       varchar("status", { length: 24 }).notNull().default("draft"),
  settledAt:    timestamp("settled_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const legalLokAdalat = settlementsSchema.table("legal_lok_adalat", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  settlementId:   uuid("settlement_id").notNull(),
  lokAdalatDate:  date("lok_adalat_date").notNull(),
  venue:          text("venue").notNull(),
  outcome:        text("outcome"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const schema = { legalSettlements, legalLokAdalat };
