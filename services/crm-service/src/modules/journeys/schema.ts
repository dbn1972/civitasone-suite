/**
 * journeys module — Drizzle schema (G1 + G2, spec §25).
 *
 * Two tables, created by migrations 0079 (stage_vocabulary) and 0080 (journey_templates):
 *
 *  - `stage_vocabulary` is the STANDARDISED stage vocabulary. `stageCode` is the stable
 *    machine key national dashboards aggregate on; `displayName` is the only part a
 *    tenant is expected to want to change, and for canonical rows it cannot.
 *  - `journey_templates` is the configurable template. Steps live in JSONB because a
 *    step is configuration, read as a whole and never queried column-wise.
 *
 * The PLATFORM sentinel tenant owns every canonical row. It is not a real tenant: it is
 * how a nationally-owned row gets a NOT NULL tenant_id without being any one circle's
 * property, and the RLS policies in 0079/0080 make those rows readable by all tenants.
 */
import { pgSchema, uuid, varchar, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

/** Owner of every governance='canonical' row. See the module README. */
export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export const GOVERNANCE = ["canonical", "tenant"] as const;
export type Governance = (typeof GOVERNANCE)[number];

export const TEMPLATE_STATUSES = ["draft", "published", "deprecated"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const stageVocabulary = crmSchema.table("stage_vocabulary", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  stageCode: varchar("stage_code", { length: 64 }).notNull(),
  displayName: varchar("display_name", { length: 200 }).notNull(),
  description: varchar("description", { length: 1000 }),
  ordinal: integer("ordinal").notNull().default(0),
  required: boolean("required").notNull().default(false),
  governance: varchar("governance", { length: 16 }).$type<Governance>().notNull().default("tenant"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/**
 * One step of a journey template, stored inside the `steps` JSONB array.
 *
 * `stageCode` must resolve against the effective stage vocabulary — that is the whole
 * standardisation mechanism. Everything after `ordinal` is the DETAIL a derived template
 * is allowed to adapt.
 */
export interface JourneyStep {
  id: string;
  stageCode: string;
  ordinal: number;
  /** Target duration for the step, in hours. Undefined = no SLA configured. */
  slaHours?: number | undefined;
  /** Opaque reference to a communication template (notification-service owns the body). */
  communicationTemplateRef?: string | undefined;
  /** Field names that must be populated before the step can be completed. */
  mandatoryFields?: string[] | undefined;
  /** Opaque assignment rule key resolved by the assignment module. */
  assignmentRule?: string | undefined;
  /** A required step may not be dropped by a derived template. */
  required?: boolean | undefined;
}

export const journeyTemplates = crmSchema.table("journey_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  templateKey: varchar("template_key", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 1000 }),
  governance: varchar("governance", { length: 16 }).$type<Governance>().notNull().default("tenant"),
  parentTemplateId: uuid("parent_template_id"),
  product: varchar("product", { length: 120 }),
  region: varchar("region", { length: 120 }),
  businessUnit: varchar("business_unit", { length: 120 }),
  steps: jsonb("steps").$type<JourneyStep[]>().notNull().default([]),
  versionNumber: integer("version_number").notNull().default(1),
  status: varchar("status", { length: 16 }).$type<TemplateStatus>().notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type StageVocabularyRow = typeof stageVocabulary.$inferSelect;
export type StageVocabularyInsert = typeof stageVocabulary.$inferInsert;
export type JourneyTemplateRow = typeof journeyTemplates.$inferSelect;
export type JourneyTemplateInsert = typeof journeyTemplates.$inferInsert;

export interface StageVocabularyView {
  id: string;
  tenantId: string;
  stageCode: string;
  displayName: string;
  description: string | null;
  ordinal: number;
  required: boolean;
  governance: Governance;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyTemplateView {
  id: string;
  tenantId: string;
  templateKey: string;
  name: string;
  description: string | null;
  governance: Governance;
  parentTemplateId: string | null;
  product: string | null;
  region: string | null;
  businessUnit: string | null;
  steps: JourneyStep[];
  versionNumber: number;
  status: TemplateStatus;
  publishedAt: string | null;
  deprecatedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const schema = { stageVocabulary, journeyTemplates };
