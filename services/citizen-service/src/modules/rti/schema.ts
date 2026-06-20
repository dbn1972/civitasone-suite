import {
  pgSchema, uuid, text, varchar, integer, timestamp, date,
} from "drizzle-orm/pg-core";

export const rtiSchema = pgSchema("rti");

export const citizenRtiRequests = rtiSchema.table("citizen_rti_requests", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  citizenId:   uuid("citizen_id"),
  rtiNo:       text("rti_no").notNull(),
  subject:     text("subject").notNull(),
  description: text("description").notNull(),
  cpioRef:     uuid("cpio_ref").notNull(),
  deadline:    date("deadline").notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("filed"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const citizenRtiResponses = rtiSchema.table("citizen_rti_responses", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  rtiId:       uuid("rti_id").notNull(),
  responseUrl: text("response_url").notNull(),
  respondedBy: uuid("responded_by").notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const citizenRtiAppeals = rtiSchema.table("citizen_rti_appeals", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  rtiId:      uuid("rti_id").notNull(),
  appealType: varchar("appeal_type", { length: 16 }).notNull().default("first"),
  grounds:    text("grounds").notNull(),
  status:     varchar("status", { length: 24 }).notNull().default("filed"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export type RtiRow         = typeof citizenRtiRequests.$inferSelect;
export type RtiInsert      = typeof citizenRtiRequests.$inferInsert;
export type RtiResponseInsert = typeof citizenRtiResponses.$inferInsert;
export type RtiAppealInsert   = typeof citizenRtiAppeals.$inferInsert;

export const schema = { citizenRtiRequests, citizenRtiResponses, citizenRtiAppeals };
