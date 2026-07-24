/**
 * Fleet read queries — tenant-scoped via db.transaction() for RLS.
 */
import { eq, and, gte, lte, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { fuelLogs, tripLogs, vehicleDocuments, driverRoster } from "./schema.js";
import type { FuelLogRow, TripLogRow, VehicleDocumentRow, DriverRosterRow } from "./schema.js";

type QueryOpts = { vehicleId?: string; from?: string; to?: string; limit: number; offset: number };

export async function listFuelLogs(tenantId: string, opts: QueryOpts): Promise<FuelLogRow[]> {
  const conds: SQL[] = [eq(fuelLogs.tenantId, tenantId)];
  if (opts.vehicleId) conds.push(eq(fuelLogs.vehicleId, opts.vehicleId));
  if (opts.from) conds.push(gte(fuelLogs.logDate, opts.from));
  if (opts.to) conds.push(lte(fuelLogs.logDate, opts.to));
  return db.transaction((tx) => tx.select().from(fuelLogs)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}

export async function listTripLogs(tenantId: string, opts: QueryOpts): Promise<TripLogRow[]> {
  const conds: SQL[] = [eq(tripLogs.tenantId, tenantId)];
  if (opts.vehicleId) conds.push(eq(tripLogs.vehicleId, opts.vehicleId));
  if (opts.from) conds.push(gte(tripLogs.tripDate, opts.from));
  if (opts.to) conds.push(lte(tripLogs.tripDate, opts.to));
  return db.transaction((tx) => tx.select().from(tripLogs)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}

export async function listVehicleDocuments(tenantId: string, vehicleId?: string): Promise<VehicleDocumentRow[]> {
  const conds: SQL[] = [eq(vehicleDocuments.tenantId, tenantId)];
  if (vehicleId) conds.push(eq(vehicleDocuments.vehicleId, vehicleId));
  return db.transaction((tx) => tx.select().from(vehicleDocuments).where(and(...conds)));
}

export async function listDriverRoster(tenantId: string, opts: QueryOpts): Promise<DriverRosterRow[]> {
  const conds: SQL[] = [eq(driverRoster.tenantId, tenantId)];
  if (opts.from) conds.push(gte(driverRoster.shiftDate, opts.from));
  if (opts.to) conds.push(lte(driverRoster.shiftDate, opts.to));
  return db.transaction((tx) => tx.select().from(driverRoster)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}
