import { pgSchema, uuid, text, varchar, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const vigilanceSchema = pgSchema("vigilance");

export const vigilanceCases = vigilanceSchema.table("vigilance_cases", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  caseNo:          text("case_no").notNull(),
  officer:         text("officer").notNull(),
  charges:         text("charges").notNull(),
  inquiryStatus:   varchar("inquiry_status", { length: 32 }).notNull().default("preliminary_enquiry"),
  outcome:         varchar("outcome", { length: 24 }).notNull().default("pending"),
  // SVC-096 additions — confidential intake / screening / IO / findings lifecycle.
  complaintSource: text("complaint_source"),
  confidential:    boolean("confidential").notNull().default(true),
  screeningStatus: varchar("screening_status", { length: 24 }).notNull().default("pending"),
  assignedIo:      text("assigned_io"),
  findings:        text("findings"),
  stage:           varchar("stage", { length: 24 }).notNull().default("intake"),
  closedAt:        timestamp("closed_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

/** SVC-096: evidence attached to a vigilance case (restricted). */
export const vigilanceEvidence = vigilanceSchema.table("vigilance_evidence", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  caseId:      uuid("case_id").notNull(),
  kind:        varchar("kind", { length: 24 }).notNull().default("document"),
  description: text("description").notNull(),
  reference:   text("reference"),
  collectedBy: text("collected_by"),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

/** SVC-096: action recommendation on a case — maker-checker (proposer != decider). */
export const vigilanceActions = vigilanceSchema.table("vigilance_actions", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  caseId:            uuid("case_id").notNull(),
  recommendation:    text("recommendation").notNull(),
  recommendedAction: varchar("recommended_action", { length: 32 }).notNull(),
  status:            varchar("status", { length: 16 }).notNull().default("proposed"),
  remarks:           text("remarks"),
  proposedBy:        uuid("proposed_by").notNull(),
  decidedBy:         uuid("decided_by"),
  decidedAt:         timestamp("decided_at", { withTimezone: true }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:           integer("version").notNull().default(1),
});

export type VigilanceCaseRow = typeof vigilanceCases.$inferSelect;
export type VigilanceCaseInsert = typeof vigilanceCases.$inferInsert;
export type VigilanceEvidenceRow = typeof vigilanceEvidence.$inferSelect;
export type VigilanceActionRow = typeof vigilanceActions.$inferSelect;
export type VigilanceActionInsert = typeof vigilanceActions.$inferInsert;

export const schema = { vigilanceCases, vigilanceEvidence, vigilanceActions };
