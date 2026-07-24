import { pgSchema, uuid, text, varchar, integer, timestamp, date, boolean } from "drizzle-orm/pg-core";

export const appealSchema = pgSchema("appeal");

export const appeals = appealSchema.table("appeals", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  applicationId:        uuid("application_id"),
  decisionRef:          text("decision_ref"),
  citizenId:            uuid("citizen_id"),
  appealType:           varchar("appeal_type", { length: 16 }).notNull().default("appeal"),
  grounds:              text("grounds").notNull(),
  decisionDate:         date("decision_date"),
  filingDeadline:       date("filing_deadline"),
  status:               varchar("status", { length: 16 }).notNull().default("filed"),
  appellateAuthorityId: uuid("appellate_authority_id"),
  recordsTransferred:   boolean("records_transferred").notNull().default(false),
  recordsTransferredAt: timestamp("records_transferred_at", { withTimezone: true }),
  orderType:            varchar("order_type", { length: 16 }),
  orderNote:            text("order_note"),
  remandTo:             uuid("remand_to"),
  outcome:              varchar("outcome", { length: 16 }),
  preparedBy:           uuid("prepared_by"),
  preparedAt:           timestamp("prepared_at", { withTimezone: true }),
  decidedBy:            uuid("decided_by"),
  decidedAt:            timestamp("decided_at", { withTimezone: true }),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
  rowVersion:           integer("row_version").notNull().default(1),
});

export const appealHearings = appealSchema.table("hearings", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  appealId:    uuid("appeal_id").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  heldAt:      timestamp("held_at", { withTimezone: true }),
  mode:        varchar("mode", { length: 16 }).notNull().default("in_person"),
  record:      text("record"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  rowVersion:  integer("row_version").notNull().default(1),
});

export type AppealRow     = typeof appeals.$inferSelect;
export type AppealInsert  = typeof appeals.$inferInsert;
export type HearingRow    = typeof appealHearings.$inferSelect;
export type HearingInsert = typeof appealHearings.$inferInsert;

export const schema = { appeals, appealHearings };
