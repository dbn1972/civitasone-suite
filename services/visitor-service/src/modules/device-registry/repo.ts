/**
 * visitor-service: device-registry reads (repo).
 *
 * Read-through via `cache.getOrLoad` for single-device lookup by ID, token hash,
 * or certificate fingerprint. List queries go straight to Postgres (RLS-scoped by
 * tenant_id). Paginated results follow the standard envelope:
 *   `{ data: T[], meta: { page, pageSize, total } }`
 *
 * Also wires the device loader for the device-auth middleware (Task 4.6):
 *   setDeviceLoader(...) is called at module init so device-auth can resolve
 *   device records without circular imports.
 *
 * Requirements validated: 3.2, 3.3, 3.4, 3.5, 3.6, 3.8
 */
import { and, eq, or, sql, count, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { devices, deviceAuditLog, type DeviceRow, type DeviceAuditLogRow } from "./schema.js";
import { setDeviceLoader, type DeviceRecord } from "./device-auth.js";

/**
 * A device row safe to serialize in API responses: the device authentication
 * secrets — the (encrypted) bearer-token hashes and the mTLS certificate
 * fingerprint — are stripped. These are credential material used only by the
 * device-auth lookup path (getDeviceByTokenHash / getDeviceByCertFingerprint)
 * and MUST NOT be echoed back in admin read endpoints.
 */
export type PublicDeviceRow = Omit<
  DeviceRow,
  "deviceTokenHash" | "oldTokenHash" | "certificateFingerprint"
>;

/** Strip device auth secrets from a device row before it leaves the service. */
export function toPublicDevice(row: DeviceRow): PublicDeviceRow {
  const {
    deviceTokenHash: _t,
    oldTokenHash: _o,
    certificateFingerprint: _c,
    ...rest
  } = row;
  return rest;
}

const RESOURCE = "device";

// ── Single-entity lookups ─────────────────────────────────────────────────

/**
 * `visitor:{tenantId}:device:{deviceId}` — cache.getOrLoad read-through (TTL 90s).
 * Returns null when the device does not exist or belongs to another tenant.
 */
export async function getDeviceById(tenantId: string, deviceId: string): Promise<DeviceRow | null> {
  return cache.getOrLoad<DeviceRow>(
    cache.makeKey(tenantId, RESOURCE, deviceId),
    async () => {
      const rows = await db
        .select()
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.tenantId, tenantId)))
        .limit(1);
      return rows[0] ?? null;
    },
    90,
  );
}

/**
 * Lookup device by device_token_hash OR old_token_hash.
 * Used by device-auth middleware for Bearer token resolution.
 * Searches both columns to support rotation grace period.
 */
export async function getDeviceByTokenHash(hash: string): Promise<DeviceRecord | null> {
  const rows = await db
    .select()
    .from(devices)
    .where(or(eq(devices.deviceTokenHash, hash), eq(devices.oldTokenHash, hash)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return mapToDeviceRecord(row);
}

/**
 * Lookup device by certificate fingerprint.
 * Used by device-auth middleware for mTLS resolution.
 */
export async function getDeviceByCertFingerprint(fingerprint: string): Promise<DeviceRecord | null> {
  const rows = await db
    .select()
    .from(devices)
    .where(eq(devices.certificateFingerprint, fingerprint))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return mapToDeviceRecord(row);
}

// ── List queries (paginated) ──────────────────────────────────────────────

export interface DeviceListFilters {
  locationId?: string;
  deviceType?: string;
  status?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

/**
 * Paginated list of devices for a tenant with optional filters.
 * Follows the standard response envelope `{ data, meta: { page, pageSize, total } }`.
 */
export async function listDevices(
  tenantId: string,
  filters: DeviceListFilters = {},
  page = 1,
  pageSize = 20,
): Promise<PaginatedResult<DeviceRow>> {
  const conditions = [eq(devices.tenantId, tenantId)];
  if (filters.locationId) conditions.push(eq(devices.locationId, filters.locationId));
  if (filters.deviceType) conditions.push(eq(devices.deviceType, filters.deviceType));
  if (filters.status) conditions.push(eq(devices.status, filters.status));

  const where = and(...conditions);
  const offset = (page - 1) * pageSize;

  const [data, totalResult] = await Promise.all([
    db
      .select()
      .from(devices)
      .where(where)
      .limit(pageSize)
      .offset(offset)
      .orderBy(desc(devices.createdAt)),
    db
      .select({ total: count() })
      .from(devices)
      .where(where),
  ]);

  const total = totalResult[0]?.total ?? 0;

  return { data, meta: { page, pageSize, total } };
}

/**
 * Get devices by type and location (for bulk operations).
 * Returns only active devices.
 */
export async function getDevicesByTypeAndLocation(
  tenantId: string,
  deviceType: string,
  locationId: string,
): Promise<DeviceRow[]> {
  return db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.tenantId, tenantId),
        eq(devices.deviceType, deviceType),
        eq(devices.locationId, locationId),
        eq(devices.status, "active"),
      ),
    );
}

// ── Audit log ─────────────────────────────────────────────────────────────

/**
 * Paginated device audit log for a specific device.
 */
export async function getDeviceAuditLog(
  tenantId: string,
  deviceId: string,
  page = 1,
  pageSize = 20,
): Promise<PaginatedResult<DeviceAuditLogRow>> {
  const where = and(
    eq(deviceAuditLog.tenantId, tenantId),
    eq(deviceAuditLog.deviceId, deviceId),
  );
  const offset = (page - 1) * pageSize;

  const [data, totalResult] = await Promise.all([
    db
      .select()
      .from(deviceAuditLog)
      .where(where)
      .limit(pageSize)
      .offset(offset)
      .orderBy(desc(deviceAuditLog.createdAt)),
    db
      .select({ total: count() })
      .from(deviceAuditLog)
      .where(where),
  ]);

  const total = totalResult[0]?.total ?? 0;

  return { data, meta: { page, pageSize, total } };
}

// ── Health dashboard reads ────────────────────────────────────────────────

export interface LocationHealthSummary {
  locationId: string;
  total: number;
  online: number;
  offline: number;
  offlineDevices: Array<{ deviceId: string; lastSeenAt: string | null; name: string }>;
}

/**
 * Read location health summary from Redis cache.
 * Key pattern: `visitor:{tenantId}:location:{locationId}:device_health`
 */
export async function getLocationHealthSummary(
  tenantId: string,
  locationId: string,
): Promise<LocationHealthSummary | null> {
  const key = `visitor:${tenantId}:location:${locationId}:device_health`;
  return cache.getOrLoad<LocationHealthSummary>(key, async () => {
    // Fallback: compute from DB if cache miss
    return computeLocationHealth(tenantId, locationId);
  }, 60);
}

/**
 * Get all location health summaries for a tenant by querying distinct locations.
 */
export async function getAllLocationHealthSummaries(
  tenantId: string,
): Promise<LocationHealthSummary[]> {
  const locationRows = await db
    .select({ locationId: devices.locationId })
    .from(devices)
    .where(and(eq(devices.tenantId, tenantId), eq(devices.status, "active")))
    .groupBy(devices.locationId);

  const summaries: LocationHealthSummary[] = [];
  for (const { locationId } of locationRows) {
    const summary = await getLocationHealthSummary(tenantId, locationId);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

/**
 * Firmware inventory: all devices with their firmware version and status.
 */
export async function getFirmwareInventory(
  tenantId: string,
): Promise<Array<{ deviceId: string; name: string; deviceType: string; firmwareVersion: string | null; firmwareStatus: string | null; locationId: string }>> {
  const rows = await db
    .select({
      deviceId: devices.id,
      name: devices.name,
      deviceType: devices.deviceType,
      firmwareVersion: devices.firmwareVersion,
      firmwareStatus: devices.firmwareStatus,
      locationId: devices.locationId,
    })
    .from(devices)
    .where(and(eq(devices.tenantId, tenantId), eq(devices.status, "active")));

  return rows;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Compute location health from DB (fallback when Redis cache is empty). */
async function computeLocationHealth(tenantId: string, locationId: string): Promise<LocationHealthSummary | null> {
  const locationDevices = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.tenantId, tenantId),
        eq(devices.locationId, locationId),
        eq(devices.status, "active"),
      ),
    );

  if (locationDevices.length === 0) return null;

  const onlineDevices = locationDevices.filter((d) => d.online);
  const offlineDevices = locationDevices.filter((d) => !d.online);

  return {
    locationId,
    total: locationDevices.length,
    online: onlineDevices.length,
    offline: offlineDevices.length,
    offlineDevices: offlineDevices.map((d) => ({
      deviceId: d.id,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      name: d.name,
    })),
  };
}

/** Map a full DeviceRow to the minimal DeviceRecord needed by device-auth. */
function mapToDeviceRecord(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    locationId: row.locationId,
    gateId: row.gateId,
    deviceType: row.deviceType as DeviceRecord["deviceType"],
    authType: row.authType as DeviceRecord["authType"],
    status: row.status,
    deviceTokenHash: row.deviceTokenHash,
    oldTokenHash: row.oldTokenHash,
    certificateFingerprint: row.certificateFingerprint,
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    tokenRotatedAt: row.tokenRotatedAt?.toISOString() ?? null,
  };
}

// ── Wire device loader for device-auth middleware ─────────────────────────

/**
 * Initialize the device loader for the device-auth middleware.
 * Must be called during module initialization (app.ts wiring).
 */
export function initDeviceLoader(): void {
  setDeviceLoader(async (lookupKey, lookupType) => {
    if (lookupType === "token_hash") return getDeviceByTokenHash(lookupKey);
    if (lookupType === "certificate_fingerprint") return getDeviceByCertFingerprint(lookupKey);
    return null;
  });
}

// Auto-wire the device loader on module load
initDeviceLoader();

// ── Gate-bound device lookup (Task 12.6) ──────────────────────────────────

/**
 * Find the active device bound to a specific gate.
 * Used by the gate-sync endpoint to include device status in the response.
 *
 * Returns null if no active device is bound to the gate.
 */
export async function getDeviceBoundToGate(
  tenantId: string,
  gateId: string,
): Promise<DeviceRow | null> {
  const rows = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.tenantId, tenantId),
        eq(devices.gateId, gateId),
        eq(devices.status, "active"),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
