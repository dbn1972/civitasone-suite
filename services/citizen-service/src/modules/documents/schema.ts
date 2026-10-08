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

// GAP-CITIZEN-DOCUMENTS-02 — server-side OAuth authorize-state + PKCE store.
export const digilockerOauthStates = documentsSchema.table("digilocker_oauth_states", {
  state:         text("state").primaryKey(),
  tenantId:      uuid("tenant_id").notNull(),
  actorId:       uuid("actor_id").notNull(),
  citizenId:     uuid("citizen_id"),
  docType:       varchar("doc_type", { length: 64 }).notNull(),
  purpose:       varchar("purpose", { length: 120 }).notNull(),
  scope:         varchar("scope", { length: 120 }).notNull().default("avs_parent_file"),
  codeVerifier:  text("code_verifier").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  redirectUri:   text("redirect_uri").notNull(),
  applicationId: uuid("application_id"),
  serviceId:     uuid("service_id"),
  consumedAt:    timestamp("consumed_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt:     timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type OauthStateRow    = typeof digilockerOauthStates.$inferSelect;
export type OauthStateInsert = typeof digilockerOauthStates.$inferInsert;

// GAP-CITIZEN-DOCUMENTS-02 — persisted DPDP consent record. A fetch requires a
// LIVE (not expired, not revoked) consent row for (tenant, citizen, docType).
export const digilockerConsents = documentsSchema.table("digilocker_consents", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  actorId:    uuid("actor_id").notNull(),
  citizenId:  uuid("citizen_id"),
  purpose:    varchar("purpose", { length: 120 }).notNull(),
  docType:    varchar("doc_type", { length: 64 }).notNull(),
  scope:      varchar("scope", { length: 120 }).notNull().default("avs_parent_file"),
  stateRef:   text("state_ref"),
  grantedAt:  timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt:  timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt:  timestamp("revoked_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  rowVersion: integer("row_version").notNull().default(1),
});

export type ConsentRow    = typeof digilockerConsents.$inferSelect;
export type ConsentInsert = typeof digilockerConsents.$inferInsert;

export const schema = { documentSubmissions, digilockerOauthStates, digilockerConsents };
