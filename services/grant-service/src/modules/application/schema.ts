import {
  pgSchema, uuid, text, varchar, char, bigint, integer, timestamp, numeric,
} from "drizzle-orm/pg-core";

export const applicationSchema = pgSchema("application");

export const grantApplications = applicationSchema.table("grant_applications", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  grantNo:              text("grant_no").notNull(),
  schemeId:             uuid("scheme_id").notNull(),
  beneficiaryId:        uuid("beneficiary_id").notNull(),
  purpose:              text("purpose").notNull(),
  amountRequestedMinor: bigint("amount_requested_minor", { mode: "bigint" }).notNull().default(0n),
  amountApprovedMinor:  bigint("amount_approved_minor", { mode: "bigint" }).notNull().default(0n),
  currency:             char("currency", { length: 3 }).notNull().default("INR"),
  status:               varchar("status", { length: 32 }).notNull().default("draft"),
  submittedAt:          timestamp("submitted_at", { withTimezone: true }),
  approvedAt:           timestamp("approved_at", { withTimezone: true }),
  rejectedAt:           timestamp("rejected_at", { withTimezone: true }),
  rejectionReason:      text("rejection_reason"),
  // 0003 hardening (P0-4 SoD): maker/checker actors
  submittedBy:          uuid("submitted_by"),
  approvedBy:           uuid("approved_by"),
  // 0013: withdraw and reviewer-assignment columns
  withdrawnAt:          timestamp("withdrawn_at", { withTimezone: true }),
  reviewerRef:          text("reviewer_ref"),
  assignedAt:           timestamp("assigned_at", { withTimezone: true }),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
  version:              integer("version").notNull().default(1),
});

export const grantAppDocuments = applicationSchema.table("grant_app_documents", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  docType:       varchar("doc_type", { length: 64 }).notNull(),
  docRef:        text("doc_ref").notNull(),       // opaque S3 key
  uploadedAt:    timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const grantScores = applicationSchema.table("grant_scores", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  applicationId:  uuid("application_id").notNull(),
  reviewerRef:    text("reviewer_ref").notNull(),  // opaque "identity_user:UUID"
  technicalScore: numeric("technical_score", { precision: 5, scale: 2 }).notNull().default("0"),
  financialScore: numeric("financial_score", { precision: 5, scale: 2 }).notNull().default("0"),
  totalScore:     numeric("total_score", { precision: 5, scale: 2 }).notNull().default("0"),
  recommendation: text("recommendation"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const grantSanctionCounters = applicationSchema.table("grant_sanction_counters", {
  tenantId: uuid("tenant_id").notNull(),
  fy:       varchar("fy", { length: 9 }).notNull(),
  nextVal:  bigint("next_val", { mode: "bigint" }).notNull().default(1n),
});

export type ApplicationRow    = typeof grantApplications.$inferSelect;
export type ApplicationInsert = typeof grantApplications.$inferInsert;
export type ScoreRow    = typeof grantScores.$inferSelect;
export type ScoreInsert = typeof grantScores.$inferInsert;

export const schema = { grantApplications, grantAppDocuments, grantScores };
