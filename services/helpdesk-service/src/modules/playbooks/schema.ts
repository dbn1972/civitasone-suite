/**
 * G13 Resolution Playbooks — Drizzle table definitions (migrations 0036–0038).
 *
 * STEPS ARE JSONB, NOT A TABLE. The rest of helpdesk-service stores ordered
 * configuration arrays that are read as a whole unit inside JSONB — see
 * catalogue_offerings.fulfilment_stages and .request_form_schema, and
 * saved_views.columns (migration 0031). Playbook steps have exactly that shape:
 * always loaded with their parent, never queried across playbooks, and frozen
 * once the version is published. A child table would add a join to every read
 * and buy nothing, since no step is ever addressed independently of its
 * playbook. Per-step COMPLETION, by contrast, IS a table
 * (playbook_run_steps) — it is written one row at a time by different actors at
 * different times and must be individually auditable.
 */
import { pgSchema, uuid, text, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { PlaybookStep } from "./domain.js";

export const helpdeskSchema = pgSchema("helpdesk");

/**
 * A versioned resolution playbook. Versioned BY ROW: publishing never mutates
 * an existing published row, so runs that reference a version's steps keep a
 * stable definition. UNIQUE (tenant_id, playbook_key, version_number).
 *
 * The four nullable matching columns are the resolution criteria; NULL means
 * "matches anything" (see domain.criteriaMatches).
 */
export const playbooks = helpdeskSchema.table("playbooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  /** Stable business key shared by every version of the same playbook. */
  playbookKey: varchar("playbook_key", { length: 128 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  versionNumber: integer("version_number").notNull().default(1),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // ── matching criteria (NULL = wildcard) ──
  categoryId: uuid("category_id"),
  productCode: varchar("product_code", { length: 64 }),
  ticketType: varchar("ticket_type", { length: 24 }),
  priority: varchar("priority", { length: 24 }),
  /** Ordered guided steps — see the JSONB rationale at the top of this file. */
  steps: jsonb("steps").$type<PlaybookStep[]>().notNull().default([]),
  // ── standard entity columns ──
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  /** Optimistic-locking counter (distinct from versionNumber, which is the
   * playbook's editorial version). */
  version: integer("version").notNull().default(1),
});

/**
 * A run binds one playbook version to one ticket.
 *
 * UNIQUE (tenant_id, ticket_id) — a DATABASE constraint, not an application
 * check: the auto-attach consumer can be redelivered concurrently with a manual
 * attach, and only the database can arbitrate that race.
 */
export const playbookRuns = helpdeskSchema.table("playbook_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  playbookId: uuid("playbook_id").notNull(),
  /** Denormalised so a run is readable without joining the playbook. */
  playbookKey: varchar("playbook_key", { length: 128 }).notNull(),
  playbookVersionNumber: integer("playbook_version_number").notNull().default(1),
  ticketId: uuid("ticket_id").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("in_progress"),
  /** Whole percent of steps completed — recomputed on every step completion. */
  progressPct: integer("progress_pct").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** True when the run was attached automatically at ticket creation. */
  autoAttached: boolean("auto_attached").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/**
 * Per-step completion for a run: who completed it and when.
 *
 * Rows are created up-front at run start (one per playbook step) so the
 * outstanding-mandatory check is a plain query with no reference back to the
 * playbook definition. UNIQUE (tenant_id, run_id, step_id).
 */
export const playbookRunSteps = helpdeskSchema.table("playbook_run_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  runId: uuid("run_id").notNull(),
  /** PlaybookStep.id within the run's playbook version. */
  stepId: varchar("step_id", { length: 64 }).notNull(),
  ordinal: integer("ordinal").notNull(),
  stepType: varchar("step_type", { length: 24 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  mandatory: boolean("mandatory").notNull().default(false),
  slaOffsetMinutes: integer("sla_offset_minutes"),
  knowledgeArticleId: uuid("knowledge_article_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: uuid("completed_by"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlaybookRow = typeof playbooks.$inferSelect;
export type PlaybookInsert = typeof playbooks.$inferInsert;
export type PlaybookRunRow = typeof playbookRuns.$inferSelect;
export type PlaybookRunInsert = typeof playbookRuns.$inferInsert;
export type PlaybookRunStepRow = typeof playbookRunSteps.$inferSelect;
export type PlaybookRunStepInsert = typeof playbookRunSteps.$inferInsert;

export const schema = { playbooks, playbookRuns, playbookRunSteps };
