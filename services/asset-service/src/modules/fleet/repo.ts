import { eq, and, desc, sql } from "drizzle-orm";
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

// ── vehicle update / assign-driver ───────────────────────────────────────

export async function updateVehicleFields(
  tx: Writer,
  id: string,
  tenantId: string,
  fields: {
    registrationNo?: string;
    make?: string;
    model?: string;
    year?: number | null;
    fuelType?: string;
    odometerKm?: number | null;
    status?: string;
  },
): Promise<void> {
  const clean = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Partial<typeof fields>;
  if (Object.keys(clean).length === 0) return;
  await (tx as typeof db).update(fleetVehicles)
    .set(clean)
    .where(and(eq(fleetVehicles.id, id), eq(fleetVehicles.tenantId, tenantId)));
}

export async function assignDriverToVehicle(
  tx: Writer,
  vehicleId: string,
  tenantId: string,
  driverId: string | null,
): Promise<void> {
  await (tx as typeof db).update(fleetVehicles)
    .set({ assignedDriverId: driverId })
    .where(and(eq(fleetVehicles.id, vehicleId), eq(fleetVehicles.tenantId, tenantId)));
}

// ── maintenance ──────────────────────────────────────────────────────────

export async function findMaintenanceById(
  id: string,
  tenantId: string,
): Promise<typeof fleetMaintenance.$inferSelect | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(fleetMaintenance)
      .where(and(eq(fleetMaintenance.id, id), eq(fleetMaintenance.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function updateMaintenanceStatus(
  tx: Writer,
  id: string,
  tenantId: string,
  status: string,
  costMinor?: bigint | null,
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (costMinor !== undefined) update.costMinor = costMinor;
  await (tx as typeof db).update(fleetMaintenance)
    .set(update)
    .where(and(eq(fleetMaintenance.id, id), eq(fleetMaintenance.tenantId, tenantId)));
}

// ── fleet dashboard ──────────────────────────────────────────────────────

export async function getFleetDashboard(tenantId: string): Promise<{
  totalVehicles: number;
  availableVehicles: number;
  scheduledMaintenance: number;
  overdueMaintenance: number;
}> {
  const [vehicleCounts, maintenanceCounts] = await Promise.all([
    scopedRead((tx) =>
      tx.select({ status: fleetVehicles.status, cnt: sql`cast(count(*) as int)` })
        .from(fleetVehicles)
        .where(eq(fleetVehicles.tenantId, tenantId))
        .groupBy(fleetVehicles.status),
    ),
    scopedRead((tx) =>
      tx.select({
        scheduledDate: fleetMaintenance.scheduledDate,
        cnt: sql`cast(count(*) as int)`,
      })
        .from(fleetMaintenance)
        .where(
          and(
            eq(fleetMaintenance.tenantId, tenantId),
            eq(fleetMaintenance.status, 'scheduled'),
          ),
        )
        .groupBy(fleetMaintenance.scheduledDate),
    ),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soonMs = today.getTime() + 7 * 24 * 60 * 60 * 1000;

  let totalVehicles = 0;
  let availableVehicles = 0;
  for (const row of vehicleCounts) {
    const c = Number(row.cnt ?? 0);
    totalVehicles += c;
    if (row.status === 'active') availableVehicles += c;
  }

  let scheduledMaintenance = 0;
  let overdueMaintenance = 0;
  for (const row of maintenanceCounts) {
    const d = row.scheduledDate ? new Date(row.scheduledDate) : null;
    const c = Number(row.cnt ?? 0);
    if (!d) { scheduledMaintenance += c; continue; }
    if (d.getTime() < today.getTime()) {
      overdueMaintenance += c;
    } else if (d.getTime() <= soonMs) {
      scheduledMaintenance += c;
    }
  }

  return { totalVehicles, availableVehicles, scheduledMaintenance, overdueMaintenance };
}
