import { pgSchema, uuid, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import type { RuleReason } from "../eligibility/domain.js";

export const discoverySchema = pgSchema("discovery");

export const discoveryConsents = discoverySchema.table("consents", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  citizenId:  uuid("citizen_id").notNull(),
  scope:      varchar("scope", { length: 48 }).notNull().default("benefit_discovery"),
  granted:    boolean("granted").notNull().default(true),
  grantedAt:  timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt:  timestamp("revoked_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  rowVersion: integer("row_version").notNull().default(1),
});

export const discoveryMatches = discoverySchema.table("matches", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  citizenId:             uuid("citizen_id").notNull(),
  serviceId:             uuid("service_id").notNull(),
  ruleSetId:             uuid("rule_set_id"),
  outcome:               varchar("outcome", { length: 16 }).notNull(),
  reasons:               jsonb("reasons").$type<RuleReason[]>().notNull().default([]),
  notified:              boolean("notified").notNull().default(false),
  enrolledApplicationId: uuid("enrolled_application_id"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
  rowVersion:            integer("row_version").notNull().default(1),
});

export type ConsentRow   = typeof discoveryConsents.$inferSelect;
export type ConsentInsert = typeof discoveryConsents.$inferInsert;
export type MatchRow      = typeof discoveryMatches.$inferSelect;
export type MatchInsert   = typeof discoveryMatches.$inferInsert;

export const schema = { discoveryConsents, discoveryMatches };
