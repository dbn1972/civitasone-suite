import { pgSchema, uuid, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { ServicePattern, FeeModel } from "../catalogue/domain.js";
import type { StatutoryReference } from "../catalogue/schema.js";

export const packsSchema = pgSchema("packs");

export const domainPacks = packsSchema.table("domain_packs", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  domainPackKey:  varchar("domain_pack_key", { length: 64 }).notNull(),
  sector:         varchar("sector", { length: 32 }).notNull(),
  jurisdiction:   varchar("jurisdiction", { length: 16 }),
  version:        integer("version").notNull().default(1),
  name:           text("name").notNull(),
  description:    text("description"),
  manifest:       jsonb("manifest").notNull().default({}),
  packKeys:       jsonb("pack_keys").notNull().default([]),
  status:         varchar("status", { length: 16 }).notNull().default("published"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  rowVersion:     integer("row_version").notNull().default(1),
});

export const servicePacks = packsSchema.table("service_packs", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  sourceTenantId:        uuid("source_tenant_id"),
  packKey:               varchar("pack_key", { length: 64 }).notNull(),
  domainPackKey:         varchar("domain_pack_key", { length: 64 }),
  name:                  text("name").notNull(),
  servicePattern:        varchar("service_pattern", { length: 32 }).$type<ServicePattern>(),
  serviceDefinitionId:   uuid("service_definition_id"),
  formId:                uuid("form_id"),
  eligibilityRuleSetId:  uuid("eligibility_rule_set_id"),
  feeModel:              varchar("fee_model", { length: 8 }).$type<FeeModel>(),
  feeRefId:              uuid("fee_ref_id"),
  workflowDefinitionId:  uuid("workflow_definition_id"),
  hoaCode:               varchar("hoa_code", { length: 32 }),
  engineBindings:        jsonb("engine_bindings").notNull().default([]),
  statutoryReferences:   jsonb("statutory_references").$type<StatutoryReference[]>().notNull().default([]),
  manifest:              jsonb("manifest").notNull().default({}),
  status:                varchar("status", { length: 16 }).notNull().default("draft"),
  version:               integer("version").notNull().default(1),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
  rowVersion:            integer("row_version").notNull().default(1),
});

export type DomainPackRow = typeof domainPacks.$inferSelect;
export type ServicePackRow = typeof servicePacks.$inferSelect;

export const schema = { domainPacks, servicePacks };
