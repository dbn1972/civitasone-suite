/**
 * device-auth — the credential-rotation grace period is now enforced (Fix 4).
 *
 * SECURITY AUDIT FINDING, now fixed (was HIGH — revoked/rotated credential
 * remained valid indefinitely): device-registry/domain.ts defines
 * `isInRotationGracePeriod(rotatedAt, gracePeriodMs, now)`,
 * `BEARER_ROTATION_GRACE_MS` (24h), and `MTLS_ROTATION_GRACE_MS` (7d) —
 * documented as: "During rotation, both the old and new credentials are
 * accepted for a configurable window: 24 hours for Bearer tokens, 7 days
 * for certificates." These were unit-tested in isolation
 * (device-registry-domain.test.ts's "isInRotationGracePeriod" describe
 * block) but, before this fix, were never imported anywhere outside
 * domain.ts and its own test — device-auth.ts (the actual authentication
 * middleware) never referenced `tokenRotatedAt`, `isInRotationGracePeriod`,
 * or either grace-period constant, despite `DeviceRecord`/`DeviceContext`
 * carrying `tokenRotatedAt` all the way through.
 *
 * The real enforcement gap was repo.ts#getDeviceByTokenHash:
 *   `.where(or(eq(devices.deviceTokenHash, hash), eq(devices.oldTokenHash, hash)))`
 * — an UNCONDITIONAL match against `old_token_hash`, with no time bound
 * applied anywhere downstream. The fix (device-auth.ts#deviceAuth): after
 * resolving the device by Bearer token hash, the middleware now compares
 * the presented token's hash against the record's CURRENT
 * `deviceTokenHash` — if it matches the OLD hash instead (the only other
 * way `resolveDevice` could have found this record), it applies
 * `isInRotationGracePeriod(tokenRotatedAt, BEARER_ROTATION_GRACE_MS)` and
 * rejects with 401 DEVICE_CREDENTIAL_REVOKED once that window has passed.
 *
 * Net effect before the fix: once a device's Bearer token was rotated (e.g.
 * specifically BECAUSE the old one leaked/was compromised — the normal
 * reason to rotate a credential), the OLD token kept authenticating
 * successfully FOREVER (until the device was rotated a second time), not
 * just for the documented 24h grace window. This test proves the fix
 * directly against the real `deviceAuth()` middleware using an old-token
 * rotation timestamp far outside any documented grace period (999 days),
 * following the exact `setDeviceLoader` + `mockRequest`/`mockReply`
 * conventions established in device-auth.test.ts.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  deviceAuth,
  hashToken,
  setDeviceLoader,
  resetDeviceAuthForTests,
  invalidateDeviceCache,
  type DeviceRecord,
} from "../src/modules/device-registry/device-auth.js";

const OLD_RAW_TOKEN = "device_old_leaked_token_should_be_dead";
const NEW_RAW_TOKEN = "device_new_rotated_token";
const OLD_TOKEN_HASH = hashToken(OLD_RAW_TOKEN);
const NEW_TOKEN_HASH = hashToken(NEW_RAW_TOKEN);

// Rotated 999 days ago — far beyond BEARER_ROTATION_GRACE_MS (24h) and even
// MTLS_ROTATION_GRACE_MS (7d). The old token below must now be rejected.
const LONG_AGO_ROTATION = new Date(Date.now() - 999 * 24 * 60 * 60 * 1000).toISOString();

// A second device rotated only 1 hour ago — still WITHIN the 24h Bearer
// grace window, so its old token must still authenticate.
const RECENT_ROTATION = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const RECENT_OLD_RAW_TOKEN = "device_recent_old_token";
const RECENT_NEW_RAW_TOKEN = "device_recent_new_token";
const RECENT_OLD_TOKEN_HASH = hashToken(RECENT_OLD_RAW_TOKEN);
const RECENT_NEW_TOKEN_HASH = hashToken(RECENT_NEW_RAW_TOKEN);

const rotatedDevice: DeviceRecord = {
  id: "d-rotated-001",
  tenantId: "t-001",
  locationId: "loc-001",
  gateId: "gate-001",
  deviceType: "printer",
  authType: "bearer_token",
  status: "active",
  deviceTokenHash: NEW_TOKEN_HASH,
  oldTokenHash: OLD_TOKEN_HASH,
  certificateFingerprint: null,
  tokenExpiresAt: null,
  tokenRotatedAt: LONG_AGO_ROTATION,
};

const recentlyRotatedDevice: DeviceRecord = {
  ...rotatedDevice,
  id: "d-rotated-002",
  deviceTokenHash: RECENT_NEW_TOKEN_HASH,
  oldTokenHash: RECENT_OLD_TOKEN_HASH,
  tokenRotatedAt: RECENT_ROTATION,
};

function mockRequest(opts: { authorization?: string }) {
  return {
    headers: { authorization: opts.authorization },
    raw: { socket: {} },
    body: null,
    deviceContext: undefined,
  } as unknown as import("fastify").FastifyRequest;
}
function mockReply() {
  return {} as unknown as import("fastify").FastifyReply;
}

describe("device-auth — old (rotated) Bearer token grace period (Fix 4)", () => {
  beforeEach(async () => {
    resetDeviceAuthForTests();
    await invalidateDeviceCache(OLD_TOKEN_HASH, "token_hash");
    await invalidateDeviceCache(NEW_TOKEN_HASH, "token_hash");
    await invalidateDeviceCache(RECENT_OLD_TOKEN_HASH, "token_hash");
    await invalidateDeviceCache(RECENT_NEW_TOKEN_HASH, "token_hash");
    setDeviceLoader(async (lookupKey) => {
      if (lookupKey === OLD_TOKEN_HASH || lookupKey === NEW_TOKEN_HASH) return rotatedDevice;
      if (lookupKey === RECENT_OLD_TOKEN_HASH || lookupKey === RECENT_NEW_TOKEN_HASH) return recentlyRotatedDevice;
      return null;
    });
  });
  afterEach(() => {
    resetDeviceAuthForTests();
  });

  it("the NEW token authenticates (expected/correct)", async () => {
    const req = mockRequest({ authorization: `Bearer ${NEW_RAW_TOKEN}` });
    await deviceAuth(req, mockReply());
    expect(req.deviceContext?.deviceId).toBe(rotatedDevice.id);
  });

  it("the OLD token, rotated 999 days ago, is rejected once the grace period has expired", async () => {
    const req = mockRequest({ authorization: `Bearer ${OLD_RAW_TOKEN}` });

    // Fixed: the 24h Bearer grace period is now enforced. deviceAuth()
    // rejects with DEVICE_CREDENTIAL_REVOKED instead of authenticating the
    // leaked/rotated-away credential as if it were still current.
    await expect(deviceAuth(req, mockReply())).rejects.toMatchObject({
      status: 401,
      code: "DEVICE_CREDENTIAL_REVOKED",
    });
    expect(req.deviceContext).toBeUndefined();
  });

  it("an OLD token rotated only 1 hour ago still authenticates (within the 24h grace window)", async () => {
    const req = mockRequest({ authorization: `Bearer ${RECENT_OLD_RAW_TOKEN}` });
    await deviceAuth(req, mockReply());
    expect(req.deviceContext?.deviceId).toBe(recentlyRotatedDevice.id);
    expect(req.deviceContext?.authType).toBe("bearer_token");
  });
});
