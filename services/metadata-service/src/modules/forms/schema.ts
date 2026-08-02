/**
 * Drizzle definitions for the forms-engine tables added by migration
 * 0004_forms_engine.sql. Column names, nullability and defaults mirror that
 * file exactly.
 *
 * A "form" here is an existing `metadata.layout_definitions` row — the form
 * builder this service already has. These tables add versioning, cascade and
 * visibility configuration, a public endpoint mapping, and the submissions
 * captured through it. Nothing duplicates the entity/field/layout model.
 *
 * PII: `form_submissions.contact_name|contact_email|contact_phone|answers` use
 * `encryptedText()` (AES-256-GCM envelope, see shared/pii-crypto.ts) per DPDP.
 * `answers` holds the JSON-encoded non-contact answers — for a public lead form
 * those are personal data too, so the whole blob is encrypted rather than left
 * in a queryable jsonb column.
 */
import { pgSchema, uuid, varchar, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";
import type { CascadeRule, VisibilityRule } from "./domain.js";
import type { FormVersionStatus } from "./publish-domain.js";

export const metadataSchema = pgSchema("metadata");

/** A versioned, maker-checker-governed snapshot of a form's rule configuration. */
export const formVersions = metadataSchema.table("form_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  layoutDefId: uuid("layout_def_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft").$type<FormVersionStatus>(),
  visibilityRules: jsonb("visibility_rules").notNull().default([]).$type<VisibilityRule[]>(),
  cascadeRules: jsonb("cascade_rules").notNull().default([]).$type<CascadeRule[]>(),
  submittedBy: uuid("submitted_by"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  publishedBy: uuid("published_by"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  supersededBy: uuid("superseded_by"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

/**
 * Maps an opaque public key to exactly one (tenant, published form version).
 *
 * This is the tenant resolution surface for the unauthenticated endpoint. It is
 * looked up INSIDE a tenant-scoped transaction whose tenant comes from the URL
 * path, so a caller must present a (tenantId, publicKey) pair that actually
 * exists together — knowing one does not grant a write against the other.
 */
export const formPublicEndpoints = metadataSchema.table("form_public_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  formVersionId: uuid("form_version_id").notNull(),
  /** 64 hex chars from crypto.randomBytes(32) — unguessable, not a slug. */
  publicKey: varchar("public_key", { length: 64 }).notNull(),
  label: varchar("label", { length: 256 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

/** A captured lead: encrypted contact + answers, plain-text UTM attribution. */
export const formSubmissions = metadataSchema.table("form_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  formVersionId: uuid("form_version_id").notNull(),
  publicEndpointId: uuid("public_endpoint_id"),
  // ── PII (AES-256-GCM envelope via encryptedText) ──────────────────────────
  contactName: encryptedText("contact_name").notNull(),
  contactEmail: encryptedText("contact_email"),
  contactPhone: encryptedText("contact_phone"),
  /** JSON-encoded non-contact answers, encrypted at rest. */
  answers: encryptedText("answers").notNull(),
  // ── UTM attribution (not PII; bounded varchar) ────────────────────────────
  utmSource: varchar("utm_source", { length: 200 }),
  utmMedium: varchar("utm_medium", { length: 200 }),
  utmCampaign: varchar("utm_campaign", { length: 200 }),
  utmTerm: varchar("utm_term", { length: 200 }),
  utmContent: varchar("utm_content", { length: 200 }),
  /** Where the submission came from: "public_web_form" | "authenticated". */
  channel: varchar("channel", { length: 32 }).notNull().default("public_web_form"),
  /** Field api-names the server stripped as hidden — audit trail for FRM-05. */
  strippedFields: jsonb("stripped_fields").notNull().default([]).$type<string[]>(),
  leadStatus: varchar("lead_status", { length: 24 }).notNull().default("captured"),
  notes: text("notes"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const formsSchema = { formVersions, formPublicEndpoints, formSubmissions };
