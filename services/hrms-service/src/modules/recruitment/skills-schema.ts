import { uuid, varchar, boolean, integer, numeric, text, date, timestamp } from "drizzle-orm/pg-core";
import { candidateSchema } from "./candidate-schema.js";

export const hrmsCandidateSkills = candidateSchema.table("hrms_candidate_skills", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  candidateId:     uuid("candidate_id").notNull(),
  skill:           varchar("skill", { length: 120 }).notNull(),
  proficiency:     varchar("proficiency", { length: 16 }).notNull(),
  yearsExperience: numeric("years_experience", { precision: 4, scale: 1 }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsCandidateCertifications = candidateSchema.table("hrms_candidate_certifications", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  candidateId:   uuid("candidate_id").notNull(),
  certName:      varchar("cert_name", { length: 200 }).notNull(),
  issuer:        varchar("issuer", { length: 200 }).notNull(),
  issueDate:     date("issue_date"),
  expiryDate:    date("expiry_date"),
  credentialId:  varchar("credential_id", { length: 120 }),
  credentialUrl: varchar("credential_url", { length: 512 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsCandidateLanguages = candidateSchema.table("hrms_candidate_languages", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  candidateId:  uuid("candidate_id").notNull(),
  language:     varchar("language", { length: 64 }).notNull(),
  canRead:      boolean("can_read").notNull().default(false),
  canWrite:     boolean("can_write").notNull().default(false),
  canSpeak:     boolean("can_speak").notNull().default(false),
  proficiency:  varchar("proficiency", { length: 16 }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsCandidateCredentials = candidateSchema.table("hrms_candidate_credentials", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  candidateId:  uuid("candidate_id").notNull(),
  kind:         varchar("kind", { length: 16 }).notNull(),
  title:        varchar("title", { length: 300 }).notNull(),
  detail:       text("detail"),
  credYear:     integer("cred_year"),
  referenceUrl: varchar("reference_url", { length: 512 }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SkillRow = typeof hrmsCandidateSkills.$inferSelect;
export type SkillInsert = typeof hrmsCandidateSkills.$inferInsert;
export type CertificationRow = typeof hrmsCandidateCertifications.$inferSelect;
export type CertificationInsert = typeof hrmsCandidateCertifications.$inferInsert;
export type LanguageRow = typeof hrmsCandidateLanguages.$inferSelect;
export type LanguageInsert = typeof hrmsCandidateLanguages.$inferInsert;
export type CredentialRow = typeof hrmsCandidateCredentials.$inferSelect;
export type CredentialInsert = typeof hrmsCandidateCredentials.$inferInsert;

export const schema = { hrmsCandidateSkills, hrmsCandidateCertifications, hrmsCandidateLanguages, hrmsCandidateCredentials };
