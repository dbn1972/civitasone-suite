// modules/check-in/schema.ts
// Drizzle table definition for visitor.check_ins, matching migration
// 0003_check_ins_blacklist_watchlist.sql exactly (column names, types,
// defaults, nullability). `timestamp` is a Postgres reserved word, so the
// column is defined with an explicit quoted name via timestamp("timestamp", ...)
// while the Drizzle field itself is named `timestamp` for ergonomic access.
//
// `passId`, `locationId`, and `gateId` reference rows owned by other
// modules' schema files (digital-pass, location) — per the established
// CivitasOne cross-module convention (see modules/digital-pass/schema.ts),
// these are left as plain uuid columns without .references() even though
// the migration itself declares the FK at the database level.
import { pgSchema, uuid, varchar, boolean, timestamp } from "drizzle-orm/pg-core";

// Multiple pgSchema("visitor") calls across this service's module files are
// expected — Drizzle allows re-declaring the same schema name in different
// files (established CivitasOne multi-module pattern, see
// modules/blacklist/schema.ts, modules/digital-pass/schema.ts).
export const visitorSchema = pgSchema("visitor");

export const checkIns = visitorSchema.table("check_ins", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  passId: uuid("pass_id").notNull(),
  locationId: uuid("location_id").notNull(),
  gateId: uuid("gate_id").notNull(),
  direction: varchar("direction", { length: 8 }).notNull(),
  // direction: in | out
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  gateTerminalId: varchar("gate_terminal_id", { length: 64 }),
  offlineRecorded: boolean("offline_recorded").notNull().default(false),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  verificationMethod: varchar("verification_method", { length: 16 }).notNull().default("qr"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type CheckInRow = typeof checkIns.$inferSelect;
export type CheckInInsert = typeof checkIns.$inferInsert;

export const schema = { checkIns };
