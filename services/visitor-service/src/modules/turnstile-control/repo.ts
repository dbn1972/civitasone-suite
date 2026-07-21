/**
 * visitor-service: turnstile-control — repository (DB reads).
 *
 * Uses cache.getOrLoad pattern for frequently-accessed records.
 * All queries are scoped to tenantId for RLS-compatible isolation.
 *
 * Requirements validated: 7.1, 7.9, 9.1
 */
import { eq, and, desc, count } from "drizzle-orm";
import { Redis } from "ioredis";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { passageEvents, deviceCommands } from "./schema.js";

// ── Redis Client ──────────────────────────────────────────────────────────

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url || process.env.CACHE_DRIVER === "memory") return null;
  _redis = new Redis(url);
  return _redis;
}

// ── In-memory fallback stores for dev/test ────────────────────────────────

const _memoryAntiPassback = new Map<string, string>();
const _memoryEmergencyFlags = new Map<string, boolean>();

/** Anti-passback state key: last known direction for a pass within a tenant. */
function antiPassbackRedisKey(tenantId: string, passId: string): string {
  return `visitor:${tenantId}:pass:${passId}:direction`;
}

/** Emergency unlock flag key for a location. */
function emergencyFlagRedisKey(tenantId: string, locationId: string): string {
  return `visitor:${tenantId}:location:${locationId}:emergency`;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Get passage events for a specific pass within a tenant.
 * Ordered by eventTimestamp descending (most recent first).
 */
export async function getPassageEvents(
  tenantId: string,
  passId: string,
): Promise<typeof passageEvents.$inferSelect[]> {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) =>
    tx
      .select()
      .from(passageEvents)
      .where(and(eq(passageEvents.tenantId, tenantId), eq(passageEvents.passId, passId)))
      .orderBy(desc(passageEvents.eventTimestamp)),
  );
}

/**
 * Get device commands for a specific device, optionally filtered by status.
 * Ordered by createdAt descending.
 */
export async function getDeviceCommands(
  tenantId: string,
  deviceId: string,
  status?: string,
): Promise<typeof deviceCommands.$inferSelect[]> {
  const conditions = [
    eq(deviceCommands.tenantId, tenantId),
    eq(deviceCommands.deviceId, deviceId),
  ];
  if (status) {
    conditions.push(eq(deviceCommands.status, status));
  }
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) =>
    tx
      .select()
      .from(deviceCommands)
      .where(and(...conditions))
      .orderBy(desc(deviceCommands.createdAt)),
  );
}

/**
 * Get the anti-passback state (last known direction) for a pass.
 * Checks Redis first, then falls back to the most recent passage event in DB.
 */
export async function getAntiPassbackState(
  tenantId: string,
  passId: string,
): Promise<string | null> {
  const key = antiPassbackRedisKey(tenantId, passId);
  const redis = getRedis();

  if (redis) {
    const cached = await redis.get(key);
    if (cached) return cached;
  } else {
    const cached = _memoryAntiPassback.get(key);
    if (cached) return cached;
  }

  // Fallback: query DB for most recent passage event.
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) =>
    tx
      .select({ direction: passageEvents.direction })
      .from(passageEvents)
      .where(and(eq(passageEvents.tenantId, tenantId), eq(passageEvents.passId, passId)))
      .orderBy(desc(passageEvents.eventTimestamp))
      .limit(1),
  );

  return rows[0]?.direction ?? null;
}

/**
 * Check whether an emergency is currently active at a location.
 */
export async function isEmergencyActive(
  tenantId: string,
  locationId: string,
): Promise<boolean> {
  const key = emergencyFlagRedisKey(tenantId, locationId);
  const redis = getRedis();

  if (redis) {
    const flag = await redis.get(key);
    return flag === "1";
  }

  return _memoryEmergencyFlags.get(key) ?? false;
}

/**
 * Clear anti-passback state for a pass (admin reset).
 */
export async function clearAntiPassbackState(
  tenantId: string,
  passId: string,
): Promise<void> {
  const key = antiPassbackRedisKey(tenantId, passId);
  const redis = getRedis();

  if (redis) {
    await redis.del(key);
  } else {
    _memoryAntiPassback.delete(key);
  }
}

/**
 * Update a device command status (e.g., when acknowledged by device).
 */
export async function updateCommandStatus(
  tenantId: string,
  commandId: string,
  status: string,
  timestamp: Date,
): Promise<boolean> {
  const updateFields: Record<string, unknown> = { status };
  if (status === "delivered") {
    updateFields.deliveredAt = timestamp;
  } else if (status === "acknowledged") {
    updateFields.acknowledgedAt = timestamp;
  }

  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this write — a bare db.update() runs with no RLS GUC set.
  await db.transaction((tx) =>
    tx
      .update(deviceCommands)
      .set(updateFields)
      .where(and(eq(deviceCommands.id, commandId), eq(deviceCommands.tenantId, tenantId))),
  );

  return true;
}

/**
 * Count pending (queued) commands for a device.
 * Used by gate-sync endpoint to report pending command count.
 */
export async function getCommandCountForDevice(
  tenantId: string,
  deviceId: string,
): Promise<number> {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const result = await scopedRead((tx) =>
    tx
      .select({ total: count() })
      .from(deviceCommands)
      .where(
        and(
          eq(deviceCommands.tenantId, tenantId),
          eq(deviceCommands.deviceId, deviceId),
          eq(deviceCommands.status, "queued"),
        ),
      ),
  );
  return result[0]?.total ?? 0;
}

// ── Test utilities ────────────────────────────────────────────────────────

export function resetRepoForTests(): void {
  _memoryAntiPassback.clear();
  _memoryEmergencyFlags.clear();
  if (_redis) {
    _redis.disconnect();
    _redis = null;
  }
}
