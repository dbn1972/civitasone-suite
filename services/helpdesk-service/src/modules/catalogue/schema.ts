import { pgSchema, uuid, text, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { FormField, FulfilmentStage } from "./domain.js";

export const helpdeskSchema = pgSchema("helpdesk");

/** Catalogue offering = a request type (form schema + fulfilment workflow + SLA). */
export const catalogueOfferings = helpdeskSchema.table("catalogue_offerings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 128 }).notNull().default("general"),
  description: text("description"),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  slaPolicyId: uuid("sla_policy_id"),
  approvalRequired: boolean("approval_required").notNull().default(false),
  requestFormSchema: jsonb("request_form_schema").$type<FormField[]>().notNull().default([]),
  fulfilmentStages: jsonb("fulfilment_stages").$type<FulfilmentStage[]>().notNull().default([]),
  defaultPriority: varchar("default_priority", { length: 24 }).notNull().default("Medium"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/** OLA / underpinning contract — internal target behind an offering's SLA. */
export const catalogueOlas = helpdeskSchema.table("catalogue_olas", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  offeringId: uuid("offering_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  kind: varchar("kind", { length: 16 }).notNull().default("ola"),
  provider: varchar("provider", { length: 200 }).notNull(),
  targetMinutes: integer("target_minutes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/** A raised self-service request (fulfilment item) linked to a helpdesk ticket. */
export const serviceRequests = helpdeskSchema.table("service_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  offeringId: uuid("offering_id").notNull(),
  ticketId: uuid("ticket_id"),
  requestedBy: uuid("requested_by").notNull(),
  formData: jsonb("form_data").$type<Record<string, unknown>>().notNull().default({}),
  status: varchar("status", { length: 24 }).notNull().default("pending_fulfilment"),
  currentStage: varchar("current_stage", { length: 64 }),
  slaPolicyId: uuid("sla_policy_id"),
  responseDeadline: timestamp("response_deadline", { withTimezone: true }),
  resolutionDeadline: timestamp("resolution_deadline", { withTimezone: true }),
  slaStatus: varchar("sla_status", { length: 16 }).notNull().default("within_sla"),
  breachEscalatedAt: timestamp("breach_escalated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/** Maker-checker approval decisions on a service request. */
export const requestApprovals = helpdeskSchema.table("request_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  requestId: uuid("request_id").notNull(),
  decision: varchar("decision", { length: 16 }).notNull(),
  decidedBy: uuid("decided_by").notNull(),
  comment: text("comment"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

/** Fulfilment stage transition audit trail. */
export const requestStageEvents = helpdeskSchema.table("request_stage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  requestId: uuid("request_id").notNull(),
  fromStage: varchar("from_stage", { length: 64 }),
  toStage: varchar("to_stage", { length: 64 }).notNull(),
  actorId: uuid("actor_id").notNull(),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export type OfferingRow = typeof catalogueOfferings.$inferSelect;
export type OfferingInsert = typeof catalogueOfferings.$inferInsert;
export type OlaRow = typeof catalogueOlas.$inferSelect;
export type OlaInsert = typeof catalogueOlas.$inferInsert;
export type ServiceRequestRow = typeof serviceRequests.$inferSelect;
export type ServiceRequestInsert = typeof serviceRequests.$inferInsert;
export type RequestApprovalRow = typeof requestApprovals.$inferSelect;
export type RequestStageEventRow = typeof requestStageEvents.$inferSelect;

export const schema = {
  catalogueOfferings,
  catalogueOlas,
  serviceRequests,
  requestApprovals,
  requestStageEvents,
};
