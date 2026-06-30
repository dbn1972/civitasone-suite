import {
  pgSchema, uuid, text, integer, timestamp,
} from "drizzle-orm/pg-core";

export const filesSchema = pgSchema("files");

export const estabDfa = filesSchema.table("estab_dfa", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  dfaNo:              text("dfa_no").notNull(),
  fileId:             uuid("file_id"),
  communicationType:  text("communication_type").notNull().default("letter"),
  templateCode:       text("template_code"),
  subject:            text("subject").notNull(),
  body:               text("body").notNull(),
  recipientEmployeeId: uuid("recipient_employee_id"),
  recipientName:      text("recipient_name"),
  recipientAddress:   text("recipient_address"),
  status:             text("status").notNull().default("draft"),
  approvedBy:         uuid("approved_by"),
  approvedAt:         timestamp("approved_at", { withTimezone: true }),
  decisionModality:   text("decision_modality").notNull().default("approved"),
  decisionConditions: text("decision_conditions"),
  returnedReason:     text("returned_reason"),
  signedBy:           uuid("signed_by"),
  signedAt:           timestamp("signed_at", { withTimezone: true }),
  signatureRef:       text("signature_ref"),
  dispatchId:         uuid("dispatch_id"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

/** Draft revision history (R3) — one row per revision of a DFA draft. */
export const estabDfaVersion = filesSchema.table("estab_dfa_version", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  dfaId:     uuid("dfa_id").notNull(),
  revNo:     integer("rev_no").notNull(),
  subject:   text("subject").notNull(),
  body:      text("body").notNull(),
  comment:   text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type DfaRow = typeof estabDfa.$inferSelect;
export type DfaInsert = typeof estabDfa.$inferInsert;
export type DfaVersionRow = typeof estabDfaVersion.$inferSelect;
export type DfaVersionInsert = typeof estabDfaVersion.$inferInsert;

export const schema = { estabDfa, estabDfaVersion };
