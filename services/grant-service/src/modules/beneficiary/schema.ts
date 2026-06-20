import {
  pgSchema, uuid, text, varchar, char, bigint, integer, boolean, timestamp,
} from "drizzle-orm/pg-core";

export const beneficiarySchema = pgSchema("beneficiary");

export const grantBeneficiaries = beneficiarySchema.table("grant_beneficiaries", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  name:               text("name").notNull(),
  type:               varchar("type", { length: 24 }).notNull().default("individual"),
  category:           text("category"),
  age:                integer("age"),
  incomeAnnualMinor:  bigint("income_annual_minor", { mode: "bigint" }).notNull().default(0n),
  currency:           char("currency", { length: 3 }).notNull().default("INR"),
  geography:          text("geography"),
  status:             varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

export const grantBankAccounts = beneficiarySchema.table("grant_bank_accounts", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  beneficiaryId:    uuid("beneficiary_id").notNull(),
  accountNoMasked:  text("account_no_masked").notNull(),  // last 4 digits only
  bankIfsc:         varchar("bank_ifsc", { length: 16 }).notNull(),
  bankName:         text("bank_name"),
  npciLinked:       boolean("npci_linked").notNull().default(false),
  status:           varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// DPDP §4: stores only last 4 digits + SHA-256 token — never raw Aadhaar
export const grantAadhaarLinks = beneficiarySchema.table("grant_aadhaar_links", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  beneficiaryId:  uuid("beneficiary_id").notNull(),
  aadhaarLast4:   char("aadhaar_last4", { length: 4 }).notNull(),
  aadhaarToken:   text("aadhaar_token").notNull(),  // SHA-256(aadhaar + salt) — non-reversible
  npciBankRef:    text("npci_bank_ref"),            // opaque "grant_bank_accounts:UUID"
  linkedAt:       timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  status:         varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type BeneficiaryRow    = typeof grantBeneficiaries.$inferSelect;
export type BeneficiaryInsert = typeof grantBeneficiaries.$inferInsert;
export type BankAccountRow    = typeof grantBankAccounts.$inferSelect;
export type BankAccountInsert = typeof grantBankAccounts.$inferInsert;
export type AadhaarLinkRow    = typeof grantAadhaarLinks.$inferSelect;
export type AadhaarLinkInsert = typeof grantAadhaarLinks.$inferInsert;

export const schema = { grantBeneficiaries, grantBankAccounts, grantAadhaarLinks };
