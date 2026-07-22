import { pgSchema, uuid, varchar, integer, bigint, timestamp } from "drizzle-orm/pg-core";

const works = pgSchema("works");

export const administrativeApprovals = works.table("administrative_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  aaNumber: varchar("aa_number", { length: 64 }).notNull(),
  aaDate: timestamp("aa_date", { withTimezone: true }).notNull(),
  approvingAuthorityId: uuid("approving_authority_id").notNull(),
  approvingOfficeId: uuid("approving_office_id"),
  approvedAmountMinor: bigint("approved_amount_minor", { mode: "bigint" }).notNull(),
  remarks: varchar("remarks", { length: 2048 }),
  approvalType: varchar("approval_type", { length: 16 }).notNull(), // original | revised
  status: varchar("status", { length: 16 }).notNull().default("draft"), // draft | finalized
  finalizedBy: uuid("finalized_by"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const technicalSanctions = works.table("technical_sanctions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  tsNumber: varchar("ts_number", { length: 64 }).notNull(),
  tsDate: timestamp("ts_date", { withTimezone: true }).notNull(),
  tsOfficeId: uuid("ts_office_id"),
  tsAuthorityId: uuid("ts_authority_id").notNull(),
  srYear: varchar("sr_year", { length: 16 }),
  zone: varchar("zone", { length: 64 }),
  tsAmountMinor: bigint("ts_amount_minor", { mode: "bigint" }).notNull(),
  remarks: varchar("remarks", { length: 2048 }),
  sanctionType: varchar("sanction_type", { length: 16 }).notNull(), // original | revised
  status: varchar("status", { length: 16 }).notNull().default("draft"), // draft | finalized
  finalizedBy: uuid("finalized_by"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { administrativeApprovals, technicalSanctions };
