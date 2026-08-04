/**
 * leads module — public lead-capture form registry (LM-002).
 *
 * One row per public web form a tenant exposes. This table is what makes an
 * unauthenticated write safe: the `formKey` in the URL is the ONLY thing an
 * anonymous caller presents, and every policy decision the public route makes
 * (which tenant, is consent mandatory, which origins, how fast) is read from
 * here rather than from the request. Nothing a prospect sends can widen it.
 *
 * See migration 0038 for the RLS story, including the narrow SELECT-only policy
 * that lets the anonymous form-key lookup resolve a tenant it does not yet know.
 */
import { pgSchema, uuid, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const leadCaptureForms = crmSchema.table("lead_capture_forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  /**
   * Server-generated high-entropy hex. Globally unique (not per tenant) because it
   * is the tenant resolver — see migration 0038. Never client-supplied.
   */
  formKey: varchar("form_key", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  /** Kill switch. Disabled forms answer the same 404 as a key that never existed. */
  enabled: boolean("enabled").notNull().default(true),
  /** DPDP Act 2023 — defaults true so the careless configuration is the safe one. */
  requireConsent: boolean("require_consent").notNull().default(true),
  /** Empty array = any origin (server-side posts carry no Origin header at all). */
  allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
  defaultLeadSource: varchar("default_lead_source", { length: 64 }),
  campaignId: uuid("campaign_id"),
  /** Per (form, client IP) budget in a 60s fixed window. DB CHECK bounds it 1..600. */
  maxPerMinute: integer("max_per_minute").notNull().default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type LeadCaptureFormRow = typeof leadCaptureForms.$inferSelect;
export type LeadCaptureFormInsert = typeof leadCaptureForms.$inferInsert;

/** Admin-facing projection. Includes formKey — an admin needs it to embed the form. */
export interface LeadCaptureFormView {
  id: string;
  tenantId: string;
  formKey: string;
  name: string;
  enabled: boolean;
  requireConsent: boolean;
  allowedOrigins: string[];
  defaultLeadSource: string | null;
  campaignId: string | null;
  maxPerMinute: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the ANONYMOUS path resolves a form key to. Deliberately a narrower type than
 * LeadCaptureFormView and never returned to the caller — it exists so a reviewer can
 * see exactly which columns influence an unauthenticated write.
 */
export interface ResolvedCaptureForm {
  id: string;
  tenantId: string;
  enabled: boolean;
  requireConsent: boolean;
  allowedOrigins: string[];
  defaultLeadSource: string | null;
  campaignId: string | null;
  maxPerMinute: number;
}

export const schema = { leadCaptureForms };
