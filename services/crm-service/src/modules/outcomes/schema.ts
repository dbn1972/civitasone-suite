/**
 * outcomes module — Drizzle schema (G18, spec §25.3).
 *
 * Two tables, created by migrations 0089 (outcome_reason_codes) and 0090
 * (interaction_outcomes):
 *
 *  - `outcomeReasonCodes` is the REUSABLE reason-code catalogue. Unlike
 *    crm.lead_reason_codes (LQ-004) it is not tied to lead lifecycle statuses: `category`
 *    says which kind of record a code describes and `appliesTo` narrows it to particular
 *    generic outcome types. `governance` distinguishes platform-owned canonical codes
 *    from tenant-owned ones, exactly as crm.stage_vocabulary does.
 *  - `interactionOutcomes` is the captured outcome of one interaction on any journey
 *    subject (contact / deal / next action).
 *
 * The outcome vocabulary is PRODUCT-AGNOSTIC on purpose. "converted" covers a customer
 * taking any product — a deposit rolled into another scheme is a converted outcome with a
 * product and an amount, not a first-class concept the platform has to know about. Domain
 * wording lives in the catalogue's `label`, i.e. in seed data.
 */
import { pgSchema, uuid, varchar, char, integer, bigint, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

/** Owner of every governance='canonical' row. Not a real tenant — see the module README. */
export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export const GOVERNANCE = ["canonical", "tenant"] as const;
export type Governance = (typeof GOVERNANCE)[number];

/**
 * The generic outcome vocabulary. Three values, and adding a fourth is a spec decision,
 * not a tenant configuration: national reporting can only add up outcomes it understands.
 * Nuance belongs in the reason code.
 */
export const OUTCOME_TYPES = ["converted", "declined", "deferred"] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];

/** What an outcome can be captured against. */
export const SUBJECT_TYPES = ["contact", "deal", "next_action"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const outcomeReasonCodes = crmSchema.table("outcome_reason_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  label: varchar("label", { length: 200 }).notNull(),
  description: varchar("description", { length: 1000 }),
  /** Which kind of record the code describes, e.g. `interaction`, `subscription`. */
  category: varchar("category", { length: 48 }).notNull().default("interaction"),
  /** Outcome types the code may be used with. EMPTY = applicable to all of them. */
  appliesTo: jsonb("applies_to").$type<OutcomeType[]>().notNull().default([]),
  governance: varchar("governance", { length: 16 }).$type<Governance>().notNull().default("tenant"),
  /** Catalogue revision of this code, part of the business key. See migration 0089. */
  versionNumber: integer("version_number").notNull().default(1),
  active: boolean("active").notNull().default(true),
  ordinal: integer("ordinal").notNull().default(0),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const interactionOutcomes = crmSchema.table("interaction_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  subjectType: varchar("subject_type", { length: 24 }).$type<SubjectType>().notNull(),
  subjectId: uuid("subject_id").notNull(),
  /** Caller's business key for this outcome on this subject — the duplicate guard. */
  outcomeRef: varchar("outcome_ref", { length: 128 }).notNull(),
  outcomeType: varchar("outcome_type", { length: 24 }).$type<OutcomeType>().notNull(),
  reasonCodeId: uuid("reason_code_id"),
  productId: uuid("product_id"),
  /** MONEY — minor units. `mode: "bigint"` so nothing ever becomes a JS number. */
  amountMinor: bigint("amount_minor", { mode: "bigint" }),
  currency: char("currency", { length: 3 }),
  followUpNextActionId: uuid("follow_up_next_action_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type OutcomeReasonCodeRow = typeof outcomeReasonCodes.$inferSelect;
export type OutcomeReasonCodeInsert = typeof outcomeReasonCodes.$inferInsert;
export type InteractionOutcomeRow = typeof interactionOutcomes.$inferSelect;
export type InteractionOutcomeInsert = typeof interactionOutcomes.$inferInsert;

export interface OutcomeReasonCodeView {
  id: string;
  tenantId: string;
  code: string;
  label: string;
  description: string | null;
  category: string;
  appliesTo: OutcomeType[];
  governance: Governance;
  versionNumber: number;
  active: boolean;
  ordinal: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InteractionOutcomeView {
  id: string;
  tenantId: string;
  subjectType: SubjectType;
  subjectId: string;
  outcomeRef: string;
  outcomeType: OutcomeType;
  reasonCodeId: string | null;
  productId: string | null;
  /** Decimal STRING of minor units, never a JSON number. */
  amountMinor: string | null;
  currency: string | null;
  followUpNextActionId: string | null;
  occurredAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const schema = { outcomeReasonCodes, interactionOutcomes };
