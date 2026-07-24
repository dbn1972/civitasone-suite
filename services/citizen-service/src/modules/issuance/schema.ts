import { pgSchema, uuid, text, varchar, integer, timestamp, jsonb, date } from "drizzle-orm/pg-core";

export const issuanceSchema = pgSchema("issuance");

export const issuanceCounters = issuanceSchema.table("counters", {
  tenantId:  uuid("tenant_id").notNull(),
  certType:  varchar("cert_type", { length: 48 }).notNull(),
  year:      integer("year").notNull(),
  lastSeq:   integer("last_seq").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const certificates = issuanceSchema.table("certificates", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  applicationId: uuid("application_id"),
  certType:      varchar("cert_type", { length: 48 }).notNull(),
  certNo:        text("cert_no"),
  seqYear:       integer("seq_year"),
  status:        varchar("status", { length: 16 }).notNull().default("requested"),
  subject:       jsonb("subject").$type<Record<string, unknown>>().notNull().default({}),
  payload:       jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  payloadHash:   text("payload_hash"),
  signature:     text("signature"),
  verifyToken:   text("verify_token"),
  validFrom:     date("valid_from"),
  validTo:       date("valid_to"),
  requestedBy:   uuid("requested_by").notNull(),
  approvedBy:    uuid("approved_by"),
  issuedAt:      timestamp("issued_at", { withTimezone: true }),
  supersededBy:  uuid("superseded_by"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  rowVersion:    integer("row_version").notNull().default(1),
});

export const certificateEvents = issuanceSchema.table("certificate_events", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  certificateId: uuid("certificate_id").notNull(),
  eventType:     varchar("event_type", { length: 24 }).notNull(),
  note:          text("note"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  rowVersion:    integer("row_version").notNull().default(1),
});

export type CounterRow      = typeof issuanceCounters.$inferSelect;
export type CertificateRow  = typeof certificates.$inferSelect;
export type CertificateInsert = typeof certificates.$inferInsert;
export type CertEventInsert  = typeof certificateEvents.$inferInsert;

export const schema = { issuanceCounters, certificates, certificateEvents };
