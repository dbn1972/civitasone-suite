import { pgSchema, uuid, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { RequiredDocument, ServiceChannel, ServicePattern, FeeModel } from "./domain.js";
import type { LaneBinding } from "./lane-bindings.js";

export const catalogueSchema = pgSchema("catalogue");

export interface StatutoryReference {
  act: string;
  section?: string;
  url?: string;
}

export type { LaneBinding };

export const serviceDefinitions = catalogueSchema.table("service_definitions", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  serviceKey:           varchar("service_key", { length: 64 }).notNull(),
  serviceId:            uuid("service_id"),
  name:                 text("name").notNull(),
  ownerDepartment:      text("owner_department"),
  servicePattern:       varchar("service_pattern", { length: 32 }).$type<ServicePattern>(),
  ownerOfficeId:        uuid("owner_office_id"),
  offeringOfficeIds:    uuid("offering_office_ids").array(),
  workflowDefinitionId: uuid("workflow_definition_id"),
  formId:               uuid("form_id"),
  feeModel:             varchar("fee_model", { length: 8 }).$type<FeeModel>(),
  hoaCode:              varchar("hoa_code", { length: 32 }),
  statutoryReferences:  jsonb("statutory_references").$type<StatutoryReference[]>().notNull().default([]),
  version:              integer("version").notNull().default(1),
  status:               varchar("status", { length: 16 }).notNull().default("draft"),
  eligibilityRuleSetId: uuid("eligibility_rule_set_id"),
  feeScheduleId:        uuid("fee_schedule_id"),
  issuanceType:         varchar("issuance_type", { length: 48 }),
  requiredDocuments:    jsonb("required_documents").$type<RequiredDocument[]>().notNull().default([]),
  /** FN-25 — per-lane SLA days + escalation designation bindings. */
  laneBindings:         jsonb("lane_bindings").$type<LaneBinding[]>().notNull().default([]),
  slaDays:              integer("sla_days"),
  channels:             jsonb("channels").$type<ServiceChannel[]>().notNull().default([]),
  forms:                jsonb("forms").$type<unknown[]>().notNull().default([]),
  outputs:              jsonb("outputs").$type<unknown[]>().notNull().default([]),
  submittedBy:          uuid("submitted_by"),
  publishedBy:          uuid("published_by"),
  publishedAt:          timestamp("published_at", { withTimezone: true }),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
  rowVersion:           integer("row_version").notNull().default(1),
});

export type ServiceDefinitionRow    = typeof serviceDefinitions.$inferSelect;
export type ServiceDefinitionInsert = typeof serviceDefinitions.$inferInsert;

export const schema = { serviceDefinitions };
