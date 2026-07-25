import { pgSchema, uuid, text, integer, boolean, varchar, numeric, timestamp } from "drizzle-orm/pg-core";

export const rtiSchema = pgSchema("rti");

/** SVC-095: the RTI application (receipt, PIO, fee, statutory deadline). */
export const rtiApplications = rtiSchema.table("rti_applications", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  applicationNo:   text("application_no").notNull(),
  applicantName:   text("applicant_name").notNull(),
  applicantAddr:   text("applicant_addr"),
  subject:         text("subject").notNull(),
  requestText:     text("request_text").notNull(),
  pioRef:          text("pio_ref"),
  lifeOrLiberty:   boolean("life_or_liberty").notNull().default(false),
  thirdParty:      boolean("third_party").notNull().default(false),
  feePaid:         numeric("fee_paid", { precision: 12, scale: 2 }).notNull().default("0"),
  additionalFee:   numeric("additional_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  receivedAt:      timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  deadlineAt:      timestamp("deadline_at", { withTimezone: true }).notNull(),
  status:          varchar("status", { length: 24 }).notNull().default("received"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

/** §6(3) transfer to the PIO of another public authority. */
export const rtiTransfers = rtiSchema.table("rti_transfers", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  applicationId:   uuid("application_id").notNull(),
  fromAuthority:   text("from_authority").notNull(),
  toAuthority:     text("to_authority").notNull(),
  reason:          text("reason"),
  transferredAt:   timestamp("transferred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

/** §11 third-party consultation record. */
export const rtiThirdPartyConsults = rtiSchema.table("rti_third_party_consults", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  applicationId:   uuid("application_id").notNull(),
  thirdParty:      text("third_party").notNull(),
  noticeAt:        timestamp("notice_at", { withTimezone: true }).notNull().defaultNow(),
  response:        text("response"),
  consented:       boolean("consented"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

/** §8/§9 exemption applied to a (partial) refusal. */
export const rtiExemptions = rtiSchema.table("rti_exemptions", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  applicationId:   uuid("application_id").notNull(),
  section:         varchar("section", { length: 16 }).notNull(),
  justification:   text("justification").notNull(),
  appliedAt:       timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

/** §7 disposal / response with the disclosure decision. */
export const rtiResponses = rtiSchema.table("rti_responses", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  applicationId:   uuid("application_id").notNull(),
  decision:        varchar("decision", { length: 16 }).notNull(),
  responseText:    text("response_text").notNull(),
  respondedAt:     timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
  respondedBy:     uuid("responded_by").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** §19 first / second appeal. Maker-checker on the order. */
export const rtiAppeals = rtiSchema.table("rti_appeals", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  applicationId:       uuid("application_id").notNull(),
  tier:                varchar("tier", { length: 8 }).notNull(),
  appellateAuthority:  text("appellate_authority").notNull(),
  grounds:             text("grounds").notNull(),
  filedAt:             timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
  deadlineAt:          timestamp("deadline_at", { withTimezone: true }).notNull(),
  orderStatus:         varchar("order_status", { length: 16 }).notNull().default("pending"),
  orderText:           text("order_text"),
  filedBy:             uuid("filed_by").notNull(),
  decidedBy:           uuid("decided_by"),
  decidedAt:           timestamp("decided_at", { withTimezone: true }),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:             integer("version").notNull().default(1),
});

/** §4 proactive-disclosure log. */
export const rtiDisclosureLog = rtiSchema.table("rti_disclosure_log", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  applicationId:   uuid("application_id"),
  category:        varchar("category", { length: 32 }).notNull(),
  description:     text("description").notNull(),
  disclosedAt:     timestamp("disclosed_at", { withTimezone: true }).notNull().defaultNow(),
  disclosedBy:     uuid("disclosed_by").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RtiApplicationRow = typeof rtiApplications.$inferSelect;
export type RtiApplicationInsert = typeof rtiApplications.$inferInsert;
export type RtiAppealRow = typeof rtiAppeals.$inferSelect;
export type RtiAppealInsert = typeof rtiAppeals.$inferInsert;

export const schema = {
  rtiApplications,
  rtiTransfers,
  rtiThirdPartyConsults,
  rtiExemptions,
  rtiResponses,
  rtiAppeals,
  rtiDisclosureLog,
};
