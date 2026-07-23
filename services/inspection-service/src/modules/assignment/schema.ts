/**
 * inspection-service: assignment module Drizzle schema.
 *
 * Defines the `assignment` PG schema with tables for inspector assignment,
 * conflict-of-interest declarations, tour planning, geo-attendance validation,
 * and inspector capacity management.
 *
 * - inspection_assignments — inspector-to-inspection mappings with scheduling
 * - conflict_declarations — declared conflicts of interest (inspector ↔ entity)
 * - tour_plans — optimized field visit schedules with JSONB slots
 * - geo_attendance — GPS check-in records with geofence validation
 * - inspector_capacity — daily limits and competency declarations per inspector
 *
 * _Requirements: 4.1, 4.2, 4.4, 4.5, 4.8_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  date,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** The `assignment` PG schema — inspector assignment and field logistics. */
export const assignmentSchema = pgSchema("assignment");

// ── assignment.inspection_assignments ─────────────────────────────────────
export const inspectionAssignments = assignmentSchema.table("inspection_assignments", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  inspectionId:     uuid("inspection_id").notNull(),
  inspectorId:      uuid("inspector_id").notNull(),
  inspectionTypeId: uuid("inspection_type_id").notNull(),
  entityId:         uuid("entity_id").notNull(),
  scheduledDate:    date("scheduled_date").notNull(),
  status:           varchar("status", { length: 24 }).notNull().default("assigned"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
}, (table) => ({
  tenantInspectorDate: index("idx_assignments_tenant_inspector_date")
    .on(table.tenantId, table.inspectorId, table.scheduledDate),
}));

// ── assignment.conflict_declarations ──────────────────────────────────────
export const conflictDeclarations = assignmentSchema.table("conflict_declarations", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  inspectorId:      uuid("inspector_id").notNull(),
  entityId:         uuid("entity_id").notNull(),
  relationshipType: varchar("relationship_type", { length: 48 }).notNull(),
  declaredAt:       timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  version:          integer("version").notNull().default(1),
}, (table) => ({
  uniqueConflictPerTenant: uniqueIndex("idx_conflict_declarations_tenant_inspector_entity")
    .on(table.tenantId, table.inspectorId, table.entityId),
}));

// ── assignment.tour_plans ─────────────────────────────────────────────────
export const tourPlans = assignmentSchema.table("tour_plans", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  inspectorId: uuid("inspector_id").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd:   date("period_end").notNull(),
  slots:       jsonb("slots").notNull(), // TourSlot[]
  // { date: string; entityId: string; inspectionId: string; latitude: number; longitude: number }[]
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
}, (table) => ({
  tenantInspector: index("idx_tour_plans_tenant_inspector")
    .on(table.tenantId, table.inspectorId),
}));

// ── assignment.geo_attendance ─────────────────────────────────────────────
export const geoAttendance = assignmentSchema.table("geo_attendance", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  inspectionId:     uuid("inspection_id").notNull(),
  inspectorId:      uuid("inspector_id").notNull(),
  latitude:         numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude:        numeric("longitude", { precision: 10, scale: 7 }).notNull(),
  entityLatitude:   numeric("entity_latitude", { precision: 10, scale: 7 }).notNull(),
  entityLongitude:  numeric("entity_longitude", { precision: 10, scale: 7 }).notNull(),
  distanceMeters:   integer("distance_meters").notNull(),
  geofenceRadius:   integer("geofence_radius").notNull(),
  locationMismatch: integer("location_mismatch").notNull().default(0), // boolean flag: 1 = mismatch
  recordedAt:       timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  version:          integer("version").notNull().default(1),
}, (table) => ({
  tenantInspection: index("idx_geo_attendance_tenant_inspection")
    .on(table.tenantId, table.inspectionId),
}));

// ── assignment.inspector_capacity ─────────────────────────────────────────
export const inspectorCapacity = assignmentSchema.table("inspector_capacity", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  inspectorId:  uuid("inspector_id").notNull(),
  dailyLimit:   integer("daily_limit").notNull().default(4),
  competencies: jsonb("competencies").notNull(), // string[]
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
}, (table) => ({
  uniqueInspectorPerTenant: uniqueIndex("idx_inspector_capacity_tenant_inspector")
    .on(table.tenantId, table.inspectorId),
}));

// ── Inferred types ────────────────────────────────────────────────────────
export type InspectionAssignmentRow = typeof inspectionAssignments.$inferSelect;
export type InspectionAssignmentInsert = typeof inspectionAssignments.$inferInsert;
export type ConflictDeclarationRow = typeof conflictDeclarations.$inferSelect;
export type ConflictDeclarationInsert = typeof conflictDeclarations.$inferInsert;
export type TourPlanRow = typeof tourPlans.$inferSelect;
export type TourPlanInsert = typeof tourPlans.$inferInsert;
export type GeoAttendanceRow = typeof geoAttendance.$inferSelect;
export type GeoAttendanceInsert = typeof geoAttendance.$inferInsert;
export type InspectorCapacityRow = typeof inspectorCapacity.$inferSelect;
export type InspectorCapacityInsert = typeof inspectorCapacity.$inferInsert;

export const schema = {
  inspectionAssignments,
  conflictDeclarations,
  tourPlans,
  geoAttendance,
  inspectorCapacity,
};
