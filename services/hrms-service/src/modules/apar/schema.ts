import {
  uuid, varchar, numeric, integer, text, jsonb, timestamp, boolean,
} from "drizzle-orm/pg-core";
import { appraisalSchema } from "../appraisals/schema.js";

export const hrmsAparScores = appraisalSchema.table("hrms_apar_scores", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  appraisalId: uuid("appraisal_id").notNull(),
  attribute:   varchar("attribute", { length: 64 }).notNull(),
  weight:      numeric("weight", { precision: 5, scale: 2 }).notNull().default("1"),
  score:       integer("score").notNull(),
  remarks:     text("remarks"),
  scoredBy:    uuid("scored_by").notNull(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsAparStageHistory = appraisalSchema.table("hrms_apar_stage_history", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  appraisalId: uuid("appraisal_id").notNull(),
  fromStage:   varchar("from_stage", { length: 24 }),
  toStage:     varchar("to_stage", { length: 24 }).notNull(),
  actorId:     uuid("actor_id").notNull(),
  actorRole:   varchar("actor_role", { length: 32 }).notNull(),
  override:    boolean("override").notNull().default(false),
  remarks:     text("remarks"),
  payload:     jsonb("payload").notNull().default({}),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AparScoreRow = typeof hrmsAparScores.$inferSelect;
export type AparScoreInsert = typeof hrmsAparScores.$inferInsert;
export type AparStageHistoryInsert = typeof hrmsAparStageHistory.$inferInsert;

export const aparSchema = { hrmsAparScores, hrmsAparStageHistory };
