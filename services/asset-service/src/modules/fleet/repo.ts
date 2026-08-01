import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  fleetVehicles, fleetMaintenance, fleetDevices, fleetDeviceTelemetry,
  type FleetVehicleInsert, type FleetVehicleRow,
  type FleetMaintenanceInsert,
  type FleetDeviceInsert, type FleetDeviceRow,
  type FleetDeviceTelemetryInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── vehicles ─────────────────────────────────────────────────────────────

export async function insertVehicle(tx: Writer, row: FleetVehicleInsert): Promise<void> {
  await tx.insert(fleetVehicles).values(row);
}

export async function findVehicleById(id: string, tenantId: string): Promise<FleetVehicleRow | null> {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) =>
    tx.select().from(fleetVehicles).where(and(eq(fleetVehicles.id, id), eq(fleetVehicles.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function updateVehiclePosition(
  tx: Writer,
  id: string,
  tenantId: string,
  fields: { lat: string; lng: string; fuelLevelPct?: number | null | undefined; lastGpsAt: Date },
): Promise<void> {
  await (tx as typeof db).update(fleetVehicles)
    .set({
      currentLat: fields.lat, currentLng: fields.lng,
      lastGpsAt: fields.lastGpsAt,
      ...(fields.fuelLevelPct !== undefined ? { fuelLevelPct: fields.fuelLevelPct } : {}),
    })
    .where(and(eq(fleetVehicles.id, id), eq(fleetVehicles.tenantId, tenantId)));
}

export async function listVehiclesByTenant(tenantId: string, opts?: { limit?: number; offset?: number }) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(fleetVehicles)
    .where(eq(fleetVehicles.tenantId, tenantId))
    .orderBy(desc(fleetVehicles.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}

// ── maintenance ──────────────────────────────────────────────────────────

export async function insertMaintenance(tx: Writer, row: FleetMaintenanceInsert): Promise<void> {
  await tx.insert(fleetMaintenance).values(row);
}

export async function listMaintenanceByTenant(tenantId: string, opts?: { limit?: number; offset?: number }) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(fleetMaintenance)
    .where(eq(fleetMaintenance.tenantId, tenantId))
    .orderBy(desc(fleetMaintenance.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}

// ── devices ──────────────────────────────────────────────────────────────

export async function insertDevice(tx: Writer, row: FleetDeviceInsert): Promise<void> {
  await tx.insert(fleetDevices).values(row);
}

export async function findDeviceById(id: string, tenantId: string): Promise<FleetDeviceRow | null> {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) =>
    tx.select().from(fleetDevices).where(and(eq(fleetDevices.id, id), eq(fleetDevices.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function listDevicesByTenant(tenantId: string, opts?: { limit?: number; offset?: number }) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(fleetDevices)
    .where(eq(fleetDevices.tenantId, tenantId))
    .orderBy(desc(fleetDevices.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}

// ── telemetry ────────────────────────────────────────────────────────────

export async function insertTelemetry(tx: Writer, row: FleetDeviceTelemetryInsert): Promise<void> {
  await tx.insert(fleetDeviceTelemetry).values(row);
}

export async function latestTelemetryForDevice(deviceId: string, tenantId: string) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(fleetDeviceTelemetry)
    .where(and(eq(fleetDeviceTelemetry.deviceId, deviceId), eq(fleetDeviceTelemetry.tenantId, tenantId)))
    .orderBy(desc(fleetDeviceTelemetry.recordedAt))
    .limit(1));
  return rows[0] ?? null;
}
