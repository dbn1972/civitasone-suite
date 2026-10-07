import {
  pgSchema, uuid, text, varchar, integer, timestamp, boolean, jsonb,
} from "drizzle-orm/pg-core";

export const grievanceSchema = pgSchema("grievance");

export interface ComplainantContact { kind: "mobile" | "email"; value: string }

export const citizenGrievances = grievanceSchema.table("citizen_grievances", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  citizenId:     uuid("citizen_id").notNull(),
  category:      text("category").notNull(),
  subject:       text("subject").notNull(),
  description:   text("description").notNull(),
  priority:      varchar("priority", { length: 16 }).notNull().default("normal"),
  departmentRef: text("department_ref"),
  assignedTo:    uuid("assigned_to"),
  status:        varchar("status", { length: 24 }).notNull().default("registered"),
  // GAP-CITIZEN-GRIEVANCES-NEW-02: attribution + complainant contact.
  filedByActor:       uuid("filed_by_actor"),
  filedOnBehalf:      boolean("filed_on_behalf").notNull().default(false),
  complainantName:    text("complainant_name"),
  complainantContact: jsonb("complainant_contact").$type<ComplainantContact[]>().notNull().default([]),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const citizenGrievanceActions = grievanceSchema.table("citizen_grievance_actions", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  grievanceId: uuid("grievance_id").notNull(),
  officerId:   uuid("officer_id").notNull(),
  actionType:  varchar("action_type", { length: 32 }).notNull(),
  note:        text("note"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const citizenEscalations = grievanceSchema.table("citizen_escalations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  grievanceId: uuid("grievance_id").notNull(),
  level:       integer("level").notNull().default(1),
  reason:      text("reason").notNull(),
  escalatedTo: uuid("escalated_to"),
  status:      varchar("status", { length: 24 }).notNull().default("open"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type GrievanceRow         = typeof citizenGrievances.$inferSelect;
export type GrievanceInsert      = typeof citizenGrievances.$inferInsert;
export type GrievanceActionInsert = typeof citizenGrievanceActions.$inferInsert;
export type EscalationInsert     = typeof citizenEscalations.$inferInsert;

export const schema = { citizenGrievances, citizenGrievanceActions, citizenEscalations };
