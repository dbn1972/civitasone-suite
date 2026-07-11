import {
  pgSchema, uuid, varchar, text, integer, boolean, timestamp, jsonb,
} from "drizzle-orm/pg-core";

// L2 schema: visitor. Each module's schema.ts calls pgSchema("visitor")
// independently (Drizzle allows multiple pgSchema() calls to the same
// schema name without conflict) — matches the pattern used across other
// multi-module services (e.g. finance-service, payroll-service).
export const visitorSchema = pgSchema("visitor");

/** Weekly business-hours schedule stored as jsonb on visitor.locations. */
export type BusinessHours = Record<
  "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
  { open: string; close: string; closed?: boolean } | null
>;

// ── visitor.locations ──────────────────────────────────────────────────
export const locations = visitorSchema.table("locations", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  name:              varchar("name", { length: 200 }).notNull(),
  address:           text("address"),
  businessHours:     jsonb("business_hours").$type<BusinessHours>().notNull(),
  capacity:          integer("capacity").notNull().default(500),
  capacityThreshold: integer("capacity_threshold").notNull().default(450),
  active:            boolean("active").notNull().default(true),
  rsaPublicKey:      text("rsa_public_key"),   // Per-location public key (gate verification)
  rsaPrivateKey:     text("rsa_private_key"),  // Per-location private key (pass signing)
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

// ── visitor.areas ───────────────────────────────────────────────────────
export const areas = visitorSchema.table("areas", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  locationId:          uuid("location_id").notNull().references(() => locations.id),
  name:                varchar("name", { length: 200 }).notNull(),
  securityLevel:       integer("security_level").notNull().default(1), // 1-5
  authorizedApprovers: jsonb("authorized_approvers").$type<string[]>().notNull().default([]),
  escortRequired:      boolean("escort_required").notNull().default(false),
  active:              boolean("active").notNull().default(true),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

// ── visitor.gates ────────────────────────────────────────────────────────
export const gates = visitorSchema.table("gates", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  areaId:     uuid("area_id").references(() => areas.id), // null = perimeter gate
  name:       varchar("name", { length: 100 }).notNull(),
  gateType:   varchar("gate_type", { length: 12 }).notNull().default("entry_exit"),
  // gate_type: entry | exit | entry_exit
  active:     boolean("active").notNull().default(true),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

// ── visitor.parking_slots ─────────────────────────────────────────────────
export const parkingSlots = visitorSchema.table("parking_slots", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  locationId:  uuid("location_id").notNull().references(() => locations.id),
  slotNumber:  varchar("slot_number", { length: 10 }).notNull(),
  category:    varchar("category", { length: 16 }).notNull(),
  // category: vip | standard | handicapped | two_wheeler | bus
  vehicleType: varchar("vehicle_type", { length: 16 }).notNull(),
  occupied:    boolean("occupied").notNull().default(false),
  occupiedBy:  uuid("occupied_by"), // vehicle_pass_id (cross-module, no FK: table added in 0004)
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:     integer("version").notNull().default(1),
});

export type LocationRow = typeof locations.$inferSelect;
export type LocationInsert = typeof locations.$inferInsert;
export type AreaRow = typeof areas.$inferSelect;
export type AreaInsert = typeof areas.$inferInsert;
export type GateRow = typeof gates.$inferSelect;
export type GateInsert = typeof gates.$inferInsert;
export type ParkingSlotRow = typeof parkingSlots.$inferSelect;
export type ParkingSlotInsert = typeof parkingSlots.$inferInsert;

export const schema = { locations, areas, gates, parkingSlots };
