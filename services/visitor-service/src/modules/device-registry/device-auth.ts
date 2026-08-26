/**
 * visitor-service: device-auth middleware (Fastify preHandler hook).
 *
 * Authenticates hardware devices making API calls to the visitor-service.
 * Supports two authentication paths:
 *   - Bearer token (printers, scanners, kiosks): hashes the token (SHA-256)
 *     and looks it up against the device record's device_token_hash or
 *     old_token_hash (during rotation grace period).
 *   - mTLS (turnstiles, barriers): extracts client certificate fingerprint
 *     from the TLS socket and matches against the device's certificate_fingerprint.
 *
 * After identity resolution, performs:
 *   - Device status check (reject suspended/deregistered → 403 DEVICE_INACTIVE)
 *   - Token expiration check (tokenExpiresAt < now → 401 DEVICE_CREDENTIAL_REVOKED)
 *   - Credential rotation grace-period check (Fix 4 — see Step 2.5 below)
 *   - Rate limiting (Redis INCR with 60s TTL window): 60 req/min for
 *     printers/scanners/kiosks, 120 req/min for turnstiles/barriers
 *   - Location mismatch detection (optional spoofing check)
 *   - Binds DeviceContext to the request for downstream handlers
 *
 * Requirements validated: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 10.1
 */
import { createHash } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { TLSSocket } from "node:tls";
import { Redis } from "ioredis";
import { HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { isInRotationGracePeriod, BEARER_ROTATION_GRACE_MS } from "./domain.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Device types supported by the hardware integration modules. */
export type DeviceType = "kiosk" | "printer" | "scanner" | "turnstile" | "barrier";

/** Authentication method used to identify the device. */
export type AuthType = "bearer_token" | "mtls";

/**
 * Context bound to the request after successful device authentication.
 * Downstream handlers access this via `req.deviceContext`.
 */
export interface DeviceContext {
  deviceId: string;
  tenantId: string;
  locationId: string;
  gateId: string | null;
  deviceType: DeviceType;
  authType: AuthType;
}

/**
 * Minimal device record shape needed by the auth middleware.
 * The full record lives in the schema — this is the cached subset.
 */
export interface DeviceRecord {
  id: string;
  tenantId: string;
  locationId: string;
  gateId: string | null;
  deviceType: DeviceType;
  authType: AuthType;
  status: string;
  deviceTokenHash: string | null;
  oldTokenHash: string | null;
  certificateFingerprint: string | null;
  tokenExpiresAt: string | null;
  tokenRotatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Fastify request augmentation
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    deviceContext?: DeviceContext;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hash of a raw device token (hex-encoded). */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Rate limits per device type (requests per minute). */
const RATE_LIMITS: Record<DeviceType, number> = {
  kiosk: 60,
  printer: 60,
  scanner: 60,
  turnstile: 120,
  barrier: 120,
};

/** Rate limit window in seconds. */
const RATE_LIMIT_WINDOW_SECONDS = 60;

// ---------------------------------------------------------------------------
// Redis client for rate limiting (raw operations not supported by Cache class)
// ---------------------------------------------------------------------------

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url || process.env.CACHE_DRIVER === "memory") return null;
  _redis = new Redis(url);
  return _redis;
}

/**
 * In-memory rate limit store for dev/test (no Redis).
 * Key → { count, expiresAt }
 */
const _memoryRateStore = new Map<string, { count: number; expiresAt: number }>();

/**
 * Increment request count for a device and check against the limit.
 * Uses Redis INCR + EXPIRE for atomic sliding window.
 * Falls back to in-memory map when Redis is unavailable.
 *
 * @returns true if the request is allowed, false if rate limit exceeded
 */
async function checkRateLimit(deviceId: string, tenantId: string, deviceType: DeviceType): Promise<boolean> {
  const limit = RATE_LIMITS[deviceType];
  const key = `visitor:${tenantId}:device:${deviceId}:rate`;
  const redis = getRedis();

  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }
    return count <= limit;
  }

  // In-memory fallback for dev/test
  const now = Date.now();
  const entry = _memoryRateStore.get(key);
  if (!entry || entry.expiresAt <= now) {
    _memoryRateStore.set(key, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_SECONDS * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

// ---------------------------------------------------------------------------
// Device lookup
// ---------------------------------------------------------------------------

/**
 * Device loader for cache.getOrLoad. Override in tests via setDeviceLoader.
 * In production this queries the devices table — wired in repo.ts (Task 4.6).
 */
type DeviceLoader = (lookupKey: string, lookupType: "token_hash" | "certificate_fingerprint") => Promise<DeviceRecord | null>;

let _deviceLoader: DeviceLoader = async () => null;

/**
 * Set the device loader function. Called during module wiring (app.ts) to
 * inject the real DB-backed loader from repo.ts.
 */
export function setDeviceLoader(loader: DeviceLoader): void {
  _deviceLoader = loader;
}

/**
 * Resolve a device record by token hash or certificate fingerprint.
 * Uses cache.getOrLoad with a 90s TTL to avoid DB hits on every request.
 */
async function resolveDevice(lookupKey: string, lookupType: "token_hash" | "certificate_fingerprint"): Promise<DeviceRecord | null> {
  const cacheKey = cache.makeKey("__device_auth__", lookupType, lookupKey);
  return cache.getOrLoad<DeviceRecord>(cacheKey, () => _deviceLoader(lookupKey, lookupType), 90);
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

/** Extract Bearer token from Authorization header. Returns null if not present or malformed. */
function extractBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  const token = parts[1] as string | undefined;
  if (!token || !token.startsWith("device_")) return null;
  return token;
}

/** Extract client certificate fingerprint from the TLS socket (mTLS path). */
function extractCertificateFingerprint(req: FastifyRequest): string | null {
  const socket = req.raw.socket as TLSSocket | undefined;
  if (!socket || typeof socket.getPeerCertificate !== "function") return null;
  const cert = socket.getPeerCertificate(/* detailed */ false);
  if (!cert || !cert.fingerprint256) return null;
  // Normalize fingerprint: uppercase, colon-separated SHA-256
  return cert.fingerprint256.toUpperCase();
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Fastify preHandler hook for device authentication.
 *
 * Usage:
 * ```ts
 * app.addHook("preHandler", deviceAuth);
 * // or per-route:
 * app.post("/v1/visitor/devices/heartbeat", { preHandler: [deviceAuth] }, handler);
 * ```
 */
export async function deviceAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // --- Step 1: Identify the device ---
  let device: DeviceRecord | null = null;
  // Fix 4: tracks whether the presented Bearer token matched the device's
  // CURRENT hash or its OLD (rotated-away) hash — repo.ts#getDeviceByTokenHash
  // matches `device_token_hash OR old_token_hash` unconditionally, with no
  // indication of which column matched, so this middleware determines it
  // itself by comparing the presented token's hash against the resolved
  // record's current `deviceTokenHash`.
  let matchedOldBearerHash = false;

  // Try Bearer token path first
  const token = extractBearerToken(req);
  if (token) {
    const tokenHash = hashToken(token);
    device = await resolveDevice(tokenHash, "token_hash");

    // If not found by primary hash, it might be the old token during rotation
    if (!device) {
      // Search by old_token_hash requires a secondary lookup.
      // The loader handles checking both columns — we pass the same hash.
      // If the primary lookup returned null, the loader should have checked
      // old_token_hash. If it still returns null, the token is invalid.
      // (The loader implementation in repo.ts will handle this.)
    }

    if (!device) {
      throw new HttpError(401, "DEVICE_CREDENTIAL_REVOKED", "invalid or revoked device token");
    }

    matchedOldBearerHash = device.deviceTokenHash !== tokenHash;
  }

  // Try mTLS path if no Bearer token found
  if (!device) {
    const fingerprint = extractCertificateFingerprint(req);
    if (fingerprint) {
      device = await resolveDevice(fingerprint, "certificate_fingerprint");
    }

    if (!device) {
      throw new HttpError(401, "DEVICE_CREDENTIAL_REVOKED", "device authentication required");
    }
  }

  // --- Step 2: Verify device status ---
  if (device.status === "suspended" || device.status === "deregistered") {
    throw new HttpError(403, "DEVICE_INACTIVE", `device is ${device.status}`);
  }

  if (device.status !== "active") {
    throw new HttpError(403, "DEVICE_INACTIVE", `device is not active (status: ${device.status})`);
  }

  // --- Step 2.5: Bearer credential-rotation grace period (Fix 4) ---
  // domain.ts defines BEARER_ROTATION_GRACE_MS / isInRotationGracePeriod but
  // nothing previously called them — repo.ts#getDeviceByTokenHash matches
  // old_token_hash with no time bound, so a rotated-away (e.g. leaked)
  // Bearer token kept authenticating forever. Once the presented token is
  // confirmed to be the OLD hash (not the current one), it is only valid
  // within BEARER_ROTATION_GRACE_MS of tokenRotatedAt.
  if (matchedOldBearerHash) {
    const rotatedAt = device.tokenRotatedAt ? new Date(device.tokenRotatedAt) : null;
    if (!isInRotationGracePeriod(rotatedAt, BEARER_ROTATION_GRACE_MS)) {
      throw new HttpError(401, "DEVICE_CREDENTIAL_REVOKED", "device token has been rotated and the grace period has expired");
    }
  }

  // --- Step 3: Check token expiration (Bearer path only) ---
  if (device.authType === "bearer_token" && device.tokenExpiresAt) {
    const expiresAt = new Date(device.tokenExpiresAt);
    if (expiresAt < new Date()) {
      throw new HttpError(401, "DEVICE_CREDENTIAL_REVOKED", "device token has expired");
    }
  }

  // --- Step 4: Rate limiting ---
  const allowed = await checkRateLimit(device.id, device.tenantId, device.deviceType);
  if (!allowed) {
    throw new HttpError(429, "DEVICE_RATE_LIMIT", `rate limit exceeded (${RATE_LIMITS[device.deviceType]} req/min)`);
  }

  // --- Step 5: Location mismatch check (spoofing detection) ---
  const locationClaim = (req.headers["x-device-location"] as string) ??
    ((req.body as Record<string, unknown> | null)?.locationId as string | undefined);
  if (locationClaim && locationClaim !== device.locationId) {
    throw new HttpError(403, "LOCATION_MISMATCH", "request location does not match device registered location");
  }

  // --- Step 6: Bind DeviceContext to request ---
  req.deviceContext = {
    deviceId: device.id,
    tenantId: device.tenantId,
    locationId: device.locationId,
    gateId: device.gateId,
    deviceType: device.deviceType,
    authType: device.authType,
  };
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/**
 * Reset internal state for test isolation. Only call from tests.
 */
export function resetDeviceAuthForTests(): void {
  _memoryRateStore.clear();
  _deviceLoader = async () => null;
  if (_redis) {
    _redis.disconnect();
    _redis = null;
  }
}

/**
 * Invalidate cached device record for a given lookup key.
 * Used in tests to ensure fresh device loader calls.
 */
export async function invalidateDeviceCache(lookupKey: string, lookupType: "token_hash" | "certificate_fingerprint"): Promise<void> {
  const cacheKey = cache.makeKey("__device_auth__", lookupType, lookupKey);
  await cache.invalidate(cacheKey);
}
