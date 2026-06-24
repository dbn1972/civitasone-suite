import {
  pgSchema, uuid, varchar, integer, text, timestamp, boolean, numeric,
} from "drizzle-orm/pg-core";

export const reservationSchema = pgSchema("reservation");

export const hrmsRosters = reservationSchema.table("hrms_rosters", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  cadre:      varchar("cadre", { length: 120 }).notNull(),
  rosterKind: varchar("roster_kind", { length: 16 }).notNull().default("point100"),
  rosterSize: integer("roster_size").notNull().default(100),
  pctSc:      numeric("pct_sc").notNull().default("15.00"),
  pctSt:      numeric("pct_st").notNull().default("7.50"),
  pctObc:     numeric("pct_obc").notNull().default("27.00"),
  pctEws:     numeric("pct_ews").notNull().default("10.00"),
  pctPwd:     numeric("pct_pwd").notNull().default("4.00"),
  cfSc:       integer("cf_sc").notNull().default(0),
  cfSt:       integer("cf_st").notNull().default(0),
  cfObc:      integer("cf_obc").notNull().default(0),
  cfEws:      integer("cf_ews").notNull().default(0),
  cfUr:       integer("cf_ur").notNull().default(0),
  status:     varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const hrmsRosterPoints = reservationSchema.table("hrms_roster_points", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  rosterId:   uuid("roster_id").notNull(),
  pointNo:    integer("point_no").notNull(),
  category:   varchar("category", { length: 8 }).notNull(),
  filled:     boolean("filled").notNull().default(false),
  employeeId: uuid("employee_id"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsSanctionedPosts = reservationSchema.table("hrms_sanctioned_posts", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  cadre:              varchar("cadre", { length: 120 }).notNull(),
  designationId:      uuid("designation_id"),
  payLevel:           varchar("pay_level", { length: 24 }),
  sanctionedStrength: integer("sanctioned_strength").notNull().default(0),
  status:             varchar("status", { length: 16 }).notNull().default("active"),
  remarks:            text("remarks"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

export type RosterRow = typeof hrmsRosters.$inferSelect;
export type RosterInsert = typeof hrmsRosters.$inferInsert;
export type SanctionedPostRow = typeof hrmsSanctionedPosts.$inferSelect;
export type SanctionedPostInsert = typeof hrmsSanctionedPosts.$inferInsert;

export const schema = { hrmsRosters, hrmsRosterPoints, hrmsSanctionedPosts };
