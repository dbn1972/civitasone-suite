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

export type DfaRow = typeof estabDfa.$inferSelect;
export type DfaInsert = typeof estabDfa.$inferInsert;

export const schema = { estabDfa };
