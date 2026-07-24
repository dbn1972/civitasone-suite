import {
  pgSchema, uuid, text, varchar, integer, timestamp, date, jsonb,
} from "drizzle-orm/pg-core";

export const applicationSchema = pgSchema("application");

export const citizenApplications = applicationSchema.table("citizen_applications", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  citizenId:   uuid("citizen_id").notNull(),
  serviceId:   uuid("service_id").notNull(),
  refNo:       text("ref_no").notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("submitted"),
  deadline:    date("deadline"),
  // SVC-082: acknowledgement + channel attribution (additive, migration 0016).
  trackingNo:      text("tracking_no"),
  channel:         varchar("channel", { length: 16 }).notNull().default("portal"),
  assistedBy:      uuid("assisted_by"),
  acknowledgedAt:  timestamp("acknowledged_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const citizenAppDocuments = applicationSchema.table("citizen_app_documents", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  docType:       varchar("doc_type", { length: 64 }).notNull(),
  docUrl:        text("doc_url").notNull(),
  uploadedAt:    timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const citizenStatusHistory = applicationSchema.table("citizen_status_history", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  fromStatus:    varchar("from_status", { length: 24 }),
  toStatus:      varchar("to_status", { length: 24 }).notNull(),
  note:          text("note"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

// SVC-082: online application & assisted-service intake — draft save/resume.
export const applicationDrafts = applicationSchema.table("application_drafts", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  citizenId:     uuid("citizen_id").notNull(),
  serviceId:     uuid("service_id").notNull(),
  serviceKey:    varchar("service_key", { length: 64 }),
  channel:       varchar("channel", { length: 16 }).notNull().default("portal"),
  assistedBy:    uuid("assisted_by"),
  formData:      jsonb("form_data").$type<Record<string, unknown>>().notNull().default({}),
  documentTypes: jsonb("document_types").$type<string[]>().notNull().default([]),
  status:        varchar("status", { length: 16 }).notNull().default("draft"),
  applicationId: uuid("application_id"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  rowVersion:    integer("row_version").notNull().default(1),
});

export type ApplicationRow         = typeof citizenApplications.$inferSelect;
export type ApplicationInsert      = typeof citizenApplications.$inferInsert;
export type AppDocumentInsert      = typeof citizenAppDocuments.$inferInsert;
export type StatusHistoryInsert    = typeof citizenStatusHistory.$inferInsert;
export type ApplicationDraftRow    = typeof applicationDrafts.$inferSelect;
export type ApplicationDraftInsert = typeof applicationDrafts.$inferInsert;

export const schema = { citizenApplications, citizenAppDocuments, citizenStatusHistory, applicationDrafts };
