import {
  pgSchema, uuid, varchar, integer, bigint, boolean, timestamp,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

const payrollSchema = pgSchema("payroll");

export const sponsorBankConfig = payrollSchema.table("sponsor_bank_config", {
  tenantId:              uuid("tenant_id").primaryKey(),
  sponsorCode:           varchar("sponsor_code", { length: 4 }).notNull(),
  sponsorIfsc:           varchar("sponsor_ifsc", { length: 11 }).notNull(),
  sponsorAccount:        encryptedText("sponsor_account").notNull(),
  utilityCode:           varchar("utility_code", { length: 18 }),
  userNumber:            varchar("user_number", { length: 20 }),
  settlementOffsetDays:  integer("settlement_offset_days").notNull().default(1),
  nachEnabled:           boolean("nach_enabled").notNull().default(true),
  apbsEnabled:           boolean("apbs_enabled").notNull().default(false),
  maxRecordsPerFile:     integer("max_records_per_file").notNull().default(100000),
  maxAmountPerFileMinor: bigint("max_amount_per_file_minor", { mode: "bigint" }).notNull().default(1000000000n),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
});

export type SponsorBankConfigRow = typeof sponsorBankConfig.$inferSelect;
export type SponsorBankConfigInsert = typeof sponsorBankConfig.$inferInsert;

export const schema = { sponsorBankConfig };
