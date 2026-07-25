/**
 * spaces module — office building/floor/room/seat inventory, occupancy,
 * seat/room allotment (maker-checker), release, licence-fee & maintenance
 * (SVC-058 general office-space gap; complements quarters/ and facilities/).
 *
 * PG Schema: `spaces`. Money as bigint paise. Optimistic locking via `version`.
 */
import {
  pgSchema, uuid, text, varchar, integer, bigint, char, timestamp,
} from "drizzle-orm/pg-core";

export const spacesSchema = pgSchema("spaces");

/** Building inventory. */
export const estabBuildings = spacesSchema.table("estab_buildings", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  code:      text("code").notNull(),
  name:      text("name").notNull(),
  address:   text("address"),
  orgUnit:   varchar("org_unit", { length: 64 }),
  status:    varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

/** Floors within a building. */
export const estabFloors = spacesSchema.table("estab_floors", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  buildingId: uuid("building_id").notNull(),
  floorNo:    integer("floor_no").notNull(),
  name:       text("name"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

/** Office rooms within a floor. */
export const estabOfficeRooms = spacesSchema.table("estab_office_rooms", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  floorId:   uuid("floor_id").notNull(),
  roomNo:    text("room_no").notNull(),
  name:      text("name"),
  roomType:  varchar("room_type", { length: 24 }).notNull().default("office"),
  capacity:  integer("capacity").notNull().default(1),
  status:    varchar("status", { length: 24 }).notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

/** Seats / workspaces within a room. */
export const estabSeats = spacesSchema.table("estab_seats", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  roomId:    uuid("room_id").notNull(),
  seatNo:    text("seat_no").notNull(),
  seatType:  varchar("seat_type", { length: 24 }).notNull().default("workstation"),
  status:    varchar("status", { length: 24 }).notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

/**
 * Allotment workflow: requested -> allotted -> occupied -> released (or cancelled).
 * Maker-checker: allottedBy (approver) != requestedBy (maker), enforced in domain.
 * target_type = 'seat' | 'room'; subject = employee_ref and/or org_unit.
 */
export const estabSpaceAllotments = spacesSchema.table("estab_space_allotments", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  targetType:      varchar("target_type", { length: 16 }).notNull(),
  targetId:        uuid("target_id").notNull(),
  employeeRef:     uuid("employee_ref"),
  orgUnit:         varchar("org_unit", { length: 64 }),
  purpose:         text("purpose"),
  status:          varchar("status", { length: 24 }).notNull().default("requested"),
  requestedBy:     uuid("requested_by").notNull(),
  requestedAt:     timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  allottedBy:      uuid("allotted_by"),
  allottedAt:      timestamp("allotted_at", { withTimezone: true }),
  occupiedAt:      timestamp("occupied_at", { withTimezone: true }),
  releasedAt:      timestamp("released_at", { withTimezone: true }),
  releaseReason:   text("release_reason"),
  cancelReason:    text("cancel_reason"),
  cancelledAt:     timestamp("cancelled_at", { withTimezone: true }),
  licenceFeeMinor: bigint("licence_fee_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

/** Maintenance requests against a building/floor/room/seat. */
export const estabMaintenanceRequests = spacesSchema.table("estab_maintenance_requests", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  assetType:       varchar("asset_type", { length: 16 }).notNull(),
  assetId:         uuid("asset_id").notNull(),
  category:        varchar("category", { length: 24 }).notNull().default("other"),
  priority:        varchar("priority", { length: 16 }).notNull().default("medium"),
  description:     text("description").notNull(),
  status:          varchar("status", { length: 24 }).notNull().default("open"),
  reportedBy:      uuid("reported_by").notNull(),
  assignedTo:      uuid("assigned_to"),
  reportedAt:      timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt:      timestamp("resolved_at", { withTimezone: true }),
  resolutionNotes: text("resolution_notes"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type BuildingRow    = typeof estabBuildings.$inferSelect;
export type BuildingInsert = typeof estabBuildings.$inferInsert;
export type FloorRow       = typeof estabFloors.$inferSelect;
export type FloorInsert    = typeof estabFloors.$inferInsert;
export type OfficeRoomRow    = typeof estabOfficeRooms.$inferSelect;
export type OfficeRoomInsert = typeof estabOfficeRooms.$inferInsert;
export type SeatRow        = typeof estabSeats.$inferSelect;
export type SeatInsert     = typeof estabSeats.$inferInsert;
export type SpaceAllotmentRow    = typeof estabSpaceAllotments.$inferSelect;
export type SpaceAllotmentInsert = typeof estabSpaceAllotments.$inferInsert;
export type MaintenanceRow    = typeof estabMaintenanceRequests.$inferSelect;
export type MaintenanceInsert = typeof estabMaintenanceRequests.$inferInsert;

export const schema = {
  estabBuildings, estabFloors, estabOfficeRooms, estabSeats,
  estabSpaceAllotments, estabMaintenanceRequests,
};
