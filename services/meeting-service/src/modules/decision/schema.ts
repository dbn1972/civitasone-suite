/**
 * decision module — Drizzle table definitions (schema `meeting`).
 *
 * Mirrors migrations/0001_meeting_core.sql column-for-column for the two decision tables:
 *   meeting.decisions, meeting.resolutions (types, nullability, defaults). The migration is
 *   the source of truth for the DDL; this file is the typed application-layer view of it.
 *
 * Money invariant (steering: Concurrency & Data Integrity): a decision's monetary impact
 * (`financial_implication`) is stored as `BIGINT` paise — never a float/`number` — and is
 * surfaced here with Drizzle `mode: "bigint"` so the value round-trips as a JS `bigint`
 * without precision loss above 2^53.
 *
 * Module isolation (steering L2): each module owns its PG schema objects. `meetingSchema`
 * is a reference to the shared `meeting` PostgreSQL schema — calling `pgSchema("meeting")`
 * here produces the same schema binding used by sibling modules, without a cross-module
 * import dependency.
 *
 * _Requirements: 11.1, 11.4, 11.8, 12.1, 12.2_
 */
import { pgSchema, uuid, text, integer, boolean, date, jsonb, bigint, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

// ─── decisions ───────────────────────────────────────────────────────────────

/**
 * `meeting.decisions` — a formal determination recorded during (or arising from) a meeting.
 *
 * Typed ERP routing (Req 22.x, see domain.ts `routeDecisionEvents`): `type` classifies the
 * decision (procurement | financial | hr | project | legal | …) so the consumer can emit the
 * matching downstream event in addition to the generic `decision.recorded` fact.
 *
 * Lineage (Req 17.4): `supersededById` points at the decision that supersedes this one, and
 * `linkedDecisionIds` records related-decision edges (supersedes / amends / implements /
 * reverses). The supersession graph is kept acyclic (see domain.ts `assertAcyclicLineage`).
 *
 * Money (steering): `financialImplication` is BIGINT paise (`mode: "bigint"`) + ISO-4217
 * `currency` (default INR). Never a float.
 */
export const decisions = meetingSchema.table("decisions", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  meetingId:            uuid("meeting_id").notNull(),
  agendaItemId:         uuid("agenda_item_id"),
  text:                 text("text").notNull(),
  type:                 varchar("type", { length: 32 }).notNull(),
  authority:            text("authority"),
  effectiveDate:        date("effective_date"),
  status:               varchar("status", { length: 16 }).notNull().default("effective"),
  responsibleOfficer:   uuid("responsible_officer"),
  deadline:             timestamp("deadline", { withTimezone: true }),
  financialImplication: bigint("financial_implication", { mode: "bigint" }),
  currency:             varchar("currency", { length: 3 }).default("INR"),
  supersededById:       uuid("superseded_by_id"),
  linkedDecisionIds:    jsonb("linked_decision_ids"),
  workflowTriggered:    boolean("workflow_triggered").notNull().default(false),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
  version:              integer("version").notNull().default(1),
});

// ─── resolutions ─────────────────────────────────────────────────────────────

/**
 * `meeting.resolutions` — a formally-voted decision with a committee-scoped resolution number,
 * recorded vote counts, computed result, and (once passed & signed) a DSC + hash for integrity.
 *
 * Numbering (Req 11.4, P25): `resolutionNumber` is sequential and unique within a committee +
 * financial year (DB `UNIQUE(tenant_id, meeting_id, resolution_number)` guards the write;
 * see domain.ts `generateResolutionNumber` / `nextResolutionSequence`).
 *
 * Circulation (Req 12, P18): when `isCirculation` is true the resolution is decided outside a
 * meeting; it is valid only if the response rate meets the configured minimum, otherwise its
 * `result` is `invalid` (see domain.ts `computeCirculationResult`). `responseRate` stores the
 * achieved rate as an integer percentage for the register/status views.
 */
export const resolutions = meetingSchema.table("resolutions", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  meetingId:           uuid("meeting_id").notNull(),
  decisionId:          uuid("decision_id"),
  resolutionNumber:    text("resolution_number").notNull(),
  text:                text("text").notNull(),
  voteType:            varchar("vote_type", { length: 32 }).notNull(),
  votesFor:            integer("votes_for").notNull().default(0),
  votesAgainst:        integer("votes_against").notNull().default(0),
  votesAbstain:        integer("votes_abstain").notNull().default(0),
  majorityRule:        varchar("majority_rule", { length: 16 }).notNull().default("simple_majority"),
  result:              varchar("result", { length: 16 }).notNull(),
  effectiveDate:       date("effective_date"),
  dscSignature:        text("dsc_signature"),
  dscSignerName:       text("dsc_signer_name"),
  dscSignedAt:         timestamp("dsc_signed_at", { withTimezone: true }),
  hashCurrent:         varchar("hash_current", { length: 64 }),
  storageKey:          text("storage_key"),
  status:              varchar("status", { length: 16 }).notNull().default("effective"),
  isCirculation:       boolean("is_circulation").notNull().default(false),
  circulationDeadline: timestamp("circulation_deadline", { withTimezone: true }),
  responseRate:        integer("response_rate"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ───────────────────────────────────────────────

export type DecisionRow      = typeof decisions.$inferSelect;
export type DecisionInsert   = typeof decisions.$inferInsert;
export type ResolutionRow    = typeof resolutions.$inferSelect;
export type ResolutionInsert = typeof resolutions.$inferInsert;

/** Module schema map — merged into the Drizzle client in shared/db.ts as this module lands. */
export const schema = { decisions, resolutions };
