import { pgSchema, uuid, varchar, integer, bigint, char, timestamp, date, text, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const deals = crmSchema.table("deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  pipelineId: uuid("pipeline_id"),
  stageId: uuid("stage_id"),
  name: varchar("name", { length: 200 }).notNull(),
  stage: varchar("stage", { length: 24 }).notNull().default("Lead"),
  valueMinor: bigint("value_minor", { mode: "bigint" }).notNull().default(0n),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  contactId: uuid("contact_id"),
  ownerId: uuid("owner_id"),
  closeDate: date("close_date"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closeReason: text("close_reason"),
  closedValueMinor: bigint("closed_value_minor", { mode: "bigint" }),
  probability: integer("probability").notNull().default(0),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  // ── OP-003: opportunity attributes gating stage progression ──
  product: varchar("product", { length: 160 }),
  quantity: integer("quantity"),
  competitors: jsonb("competitors").$type<string[]>().notNull().default([]),
  nextStep: text("next_step"),
  expectedCloseDate: date("expected_close_date"),
  // ── OP-005: stage-ageing tracking ──
  stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }),
  // ── OP-006: extended closure ──
  closeOutcome: varchar("close_outcome", { length: 16 }),
  closeCompetitor: jsonb("close_competitor").$type<string[] | null>(),
  /**
   * G12 (Journey J6): the government programme this opportunity is registered under.
   * Nullable with no default — every pre-existing deal stays NULL and no deals write path
   * sets it. Only crm.programme.link_deal populates it.
   */
  programmeId: uuid("programme_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type DealRow = typeof deals.$inferSelect;
export type DealInsert = typeof deals.$inferInsert;

export type DealView = {
  id: string;
  tenantId: string;
  pipelineId: string | null;
  stageId: string | null;
  name: string;
  stage: string;
  valueMinor: string;
  currency: string;
  valueDisplay: string;
  contactId: string | null;
  contactName: string | null;
  ownerId: string | null;
  closeDate: string | null;
  closedAt: string | null;
  closeReason: string | null;
  /** Realised amount in minor units, set when the deal is closed (OP-006). */
  closedValueMinor: string | null;
  probability: number;
  status: string;
  product: string | null;
  quantity: number | null;
  competitors: string[];
  nextStep: string | null;
  expectedCloseDate: string | null;
  stageEnteredAt: string | null;
  closeOutcome: string | null;
  closeCompetitor: string[] | null;
  /** G12: programme this deal is registered under, null for every unlinked deal. */
  programmeId: string | null;
  version: number;
};

export const schema = { deals };
