import { pgSchema, uuid, text, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const documentsSchema = pgSchema("documents");

export const documentSubmissions = documentsSchema.table("submissions", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  applicationId:      uuid("application_id"),
  citizenId:          uuid("citizen_id"),
  serviceId:          uuid("service_id"),
  docType:            varchar("doc_type", { length: 64 }).notNull(),
  source:             varchar("source", { length: 16 }).notNull().default("upload"),
  storageRef:         text("storage_ref"),
  digilockerRef:      text("digilocker_ref"),
  providerStatus:     varchar("provider_status", { length: 24 }),
  status:             varchar("status", { length: 16 }).notNull().default("received"),
  verificationStatus: varchar("verification_status", { length: 16 }).notNull().default("pending"),
  authenticity:       varchar("authenticity", { length: 16 }).notNull().default("unverified"),
  deficiencyReason:   text("deficiency_reason"),
  supersedesId:       uuid("supersedes_id"),
  verifiedBy:         uuid("verified_by"),
  verifiedAt:         timestamp("verified_at", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  rowVersion:         integer("row_version").notNull().default(1),
});

export type DocSubmissionRow    = typeof documentSubmissions.$inferSelect;
export type DocSubmissionInsert = typeof documentSubmissions.$inferInsert;

export const schema = { documentSubmissions };
