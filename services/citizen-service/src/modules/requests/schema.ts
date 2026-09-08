import {
  pgSchema, uuid, text, varchar, integer, timestamp,
} from "drizzle-orm/pg-core";

// COMP-002: real backing store for the citizen service-request portal
// (POST/GET/PATCH /v1/citizen/requests, GET /v1/citizen/portal/metrics),
// replacing the fabricated-success routes formerly in modules/gap/routes.ts.
export const requestsSchema = pgSchema("requests");

export const citizenRequests = requestsSchema.table("citizen_requests", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  citizenId:           uuid("citizen_id").notNull(),
  category:            varchar("category", { length: 64 }).notNull().default("general"),
  subject:             text("subject").notNull(),
  description:         text("description").notNull(),
  channel:             varchar("channel", { length: 24 }).notNull().default("portal"),
  status:              varchar("status", { length: 24 }).notNull().default("submitted"),
  assigneeDepartment:  varchar("assignee_department", { length: 128 }),
  resolvedAt:          timestamp("resolved_at", { withTimezone: true }),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export const citizenRequestStatusHistory = requestsSchema.table("citizen_request_status_history", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  requestId:  uuid("request_id").notNull(),
  fromStatus: varchar("from_status", { length: 24 }),
  toStatus:   varchar("to_status", { length: 24 }).notNull(),
  note:       text("note"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
});

export type CitizenRequestRow           = typeof citizenRequests.$inferSelect;
export type CitizenRequestInsert        = typeof citizenRequests.$inferInsert;
export type CitizenRequestHistoryInsert = typeof citizenRequestStatusHistory.$inferInsert;

export const schema = { citizenRequests, citizenRequestStatusHistory };
