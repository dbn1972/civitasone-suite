import {
  pgSchema, uuid, text, bigint, char, varchar, integer, timestamp, date, boolean,
} from "drizzle-orm/pg-core";

export const bankReconSchema = pgSchema("treasury");

export const bankStatement = bankReconSchema.table("finance_bank_statement", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  bankAccountId: uuid("bank_account_id").notNull(),
  statementRef:  text("statement_ref"),
  periodFrom:    date("period_from"),
  periodTo:      date("period_to"),
  openingMinor:  bigint("opening_minor", { mode: "bigint" }).notNull().default(0n),
  closingMinor:  bigint("closing_minor", { mode: "bigint" }).notNull().default(0n),
  lineCount:     integer("line_count").notNull().default(0),
  status:        varchar("status", { length: 16 }).notNull().default("imported"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export const bankStatementLines = bankReconSchema.table("finance_bank_statement_lines", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  statementId:  uuid("statement_id").notNull(),
  lineDate:     date("line_date").notNull(),
  amountMinor:  bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  direction:    varchar("direction", { length: 6 }).notNull(),
  narration:    text("narration"),
  reference:    text("reference"),
  matched:      boolean("matched").notNull().default(false),
  matchType:    varchar("match_type", { length: 16 }),
  matchId:      uuid("match_id"),
  matchedAt:    timestamp("matched_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BankStatementRow      = typeof bankStatement.$inferSelect;
export type BankStatementInsert   = typeof bankStatement.$inferInsert;
export type BankStatementLineRow    = typeof bankStatementLines.$inferSelect;
export type BankStatementLineInsert = typeof bankStatementLines.$inferInsert;

export const schema = { bankStatement, bankStatementLines };
