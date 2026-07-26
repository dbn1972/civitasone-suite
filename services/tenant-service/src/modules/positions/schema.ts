import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

const tenantSchema = pgSchema("tenant");

export const positions = tenantSchema.table("positions", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  orgUnitId:          uuid("org_unit_id"),
  code:               varchar("code", { length: 48 }).notNull(),
  title:              varchar("title", { length: 200 }).notNull(),
  grade:              varchar("grade", { length: 48 }),
  sanctionedStrength: integer("sanctioned_strength").notNull().default(1),
  filledStrength:     integer("filled_strength").notNull().default(0),
  status:             varchar("status", { length: 16 }).notNull().default("active"),
  effectiveFrom:      timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo:        timestamp("effective_to", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
});

export const positionRoleMap = tenantSchema.table("position_role_map", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  positionId: uuid("position_id").notNull(),
  roleKey:    varchar("role_key", { length: 64 }).notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
});

export type PositionRow = typeof positions.$inferSelect;
export type PositionRoleRow = typeof positionRoleMap.$inferSelect;
export const positionSchema = { positions, positionRoleMap };
