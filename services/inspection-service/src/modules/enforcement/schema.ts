/**
 * inspection-service: Penalty & Enforcement module Drizzle schema.
 *
 * Defines the `enforcement` PG schema with tables:
 * - penalty_rates — configurable penalty rate schedules
 * - show_cause_notices — show cause notices issued to entities
 * - penalty_orders — penalty orders with maker-checker enforcement
 * - prosecution_referrals — referrals to legal-service for prosecution
 *
 * _Requirements: SVC-107_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  date,
  bigint,
  boolean,
} from "drizzle-orm/pg-core";

/** The `enforcement` PG schema — penalties, show cause, prosecution. */
export const enforcementSchema = pgSchema("enforcement");

// ── enforcement.penalty_rates ─────────────────────────────────────────────
export const penaltyRates = enforcementSchema.table("penalty_rates", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  provisionId:     uuid("provision_id").notNull(),
  effectiveFrom:   date("effective_from").notNull(),
  effectiveTo:     date("effective_to"),
  amount:          bigint("amount", { mode: "bigint" }).notNull(), // paise
  currency:        varchar("currency", { length: 3 }).notNull().default("INR"),
  description:     text("description"),
  isActive:        boolean("is_active").notNull().default(true),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

// ── enforcement.show_cause_notices ────────────────────────────────────────
export const showCauseNotices = enforcementSchema.table("show_cause_notices", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  findingId:         uuid("finding_id").notNull(),
  entityId:          uuid("entity_id").notNull(),
  issuedTo:          text("issued_to").notNull(),
  issuedAt:          timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  responseDeadline:  date("response_deadline").notNull(),
  responseReceived:  boolean("response_received").notNull().default(false),
  responseText:      text("response_text"),
  status:            varchar("status", { length: 24 }).notNull().default("issued"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

// ── enforcement.penalty_orders ────────────────────────────────────────────
export const penaltyOrders = enforcementSchema.table("penalty_orders", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  showCauseId:     uuid("show_cause_id"),
  findingId:       uuid("finding_id").notNull(),
  entityId:        uuid("entity_id").notNull(),
  penaltyRateId:   uuid("penalty_rate_id"),
  amount:          bigint("amount", { mode: "bigint" }).notNull(), // paise
  currency:        varchar("currency", { length: 3 }).notNull().default("INR"),
  status:          varchar("status", { length: 24 }).notNull().default("draft"),
  issuedBy:        uuid("issued_by"),
  issuedAt:        timestamp("issued_at", { withTimezone: true }),
  makerUserId:     uuid("maker_user_id").notNull(),
  checkerUserId:   uuid("checker_user_id"),
  financeDemandId: uuid("finance_demand_id"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

// ── enforcement.prosecution_referrals ─────────────────────────────────────
export const prosecutionReferrals = enforcementSchema.table("prosecution_referrals", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  penaltyOrderId:  uuid("penalty_order_id").notNull(),
  findingId:       uuid("finding_id").notNull(),
  entityId:        uuid("entity_id").notNull(),
  legalCaseId:     uuid("legal_case_id"),
  referredBy:      uuid("referred_by").notNull(),
  referredAt:      timestamp("referred_at", { withTimezone: true }).notNull().defaultNow(),
  status:          varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────
export type PenaltyRateRow = typeof penaltyRates.$inferSelect;
export type PenaltyRateInsert = typeof penaltyRates.$inferInsert;
export type ShowCauseNoticeRow = typeof showCauseNotices.$inferSelect;
export type ShowCauseNoticeInsert = typeof showCauseNotices.$inferInsert;
export type PenaltyOrderRow = typeof penaltyOrders.$inferSelect;
export type PenaltyOrderInsert = typeof penaltyOrders.$inferInsert;
export type ProsecutionReferralRow = typeof prosecutionReferrals.$inferSelect;
export type ProsecutionReferralInsert = typeof prosecutionReferrals.$inferInsert;

export const schema = { penaltyRates, showCauseNotices, penaltyOrders, prosecutionReferrals };
