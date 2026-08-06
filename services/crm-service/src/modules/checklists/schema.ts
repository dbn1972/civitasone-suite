/**
 * checklists module — Drizzle schema for crm.checklist_templates and
 * crm.checklist_instances (G7).
 *
 * `sections` and `structure` both hold `ChecklistSection[]` as defined by
 * @civitasone/checklist. `structure` is a FROZEN COPY of the published template's
 * sections taken at instantiation: a template version published later must not
 * retroactively change what an in-flight case was asked.
 *
 * `subjectId` is an opaque id into the onboarding / deals / contacts / accounts
 * domains. This module never joins to them — module isolation — it only records what
 * the caller named.
 */
import { pgSchema, uuid, varchar, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import type { ChecklistResponses, ChecklistSection } from "@civitasone/checklist";

export const crmSchema = pgSchema("crm");

/** Template lifecycle. A published template is immutable; amending means a new version. */
export const TEMPLATE_STATUSES = ["draft", "published", "deprecated"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/** Instance lifecycle. */
export const INSTANCE_STATUSES = ["in_progress", "completed", "cancelled"] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

/** What a checklist can be bound to. */
export const SUBJECT_TYPES = ["onboarding_case", "deal", "contact", "account"] as const;
export type ChecklistSubjectType = (typeof SUBJECT_TYPES)[number];

export const checklistTemplates = crmSchema.table("checklist_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  /** Stable business key shared by every version of one checklist. */
  templateKey: varchar("template_key", { length: 64 }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  /** ChecklistSection[] — the whole template body. */
  sections: jsonb("sections").notNull().default([]),
  versionNumber: integer("version_number").notNull().default(1),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  /** Optimistic locking counter — distinct from `versionNumber`, which versions the template. */
  version: integer("version").notNull().default(1),
});

export const checklistInstances = crmSchema.table("checklist_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  subjectType: varchar("subject_type", { length: 24 }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  templateId: uuid("template_id").notNull(),
  templateKey: varchar("template_key", { length: 64 }).notNull(),
  templateVersionNumber: integer("template_version_number").notNull(),
  /** Deep copy of the template's sections, frozen at instantiation. */
  structure: jsonb("structure").notNull(),
  /** Record<questionId, { value, answeredAt }>. May contain personal data — never emitted in events. */
  responses: jsonb("responses").notNull().default({}),
  status: varchar("status", { length: 16 }).notNull().default("in_progress"),
  score: integer("score").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ChecklistTemplateRow = typeof checklistTemplates.$inferSelect;
export type ChecklistTemplateInsert = typeof checklistTemplates.$inferInsert;
export type ChecklistInstanceRow = typeof checklistInstances.$inferSelect;
export type ChecklistInstanceInsert = typeof checklistInstances.$inferInsert;

/** API projection of a template. Timestamps are ISO-8601 strings. */
export interface ChecklistTemplateView {
  id: string;
  tenantId: string;
  templateKey: string;
  name: string;
  description: string | null;
  sections: ChecklistSection[];
  versionNumber: number;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** API projection of an instance. */
export interface ChecklistInstanceView {
  id: string;
  tenantId: string;
  subjectType: string;
  subjectId: string;
  templateId: string;
  templateKey: string;
  templateVersionNumber: number;
  structure: ChecklistSection[];
  responses: ChecklistResponses;
  status: string;
  score: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const schema = { checklistTemplates, checklistInstances };
