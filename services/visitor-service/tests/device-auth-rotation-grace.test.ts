/**
 * device-auth — the credential-rotation grace period is defined but never
 * enforced.
 *
 * SECURITY AUDIT FINDING (HIGH — revoked/rotated credential remains valid
 * indefinitely): device-registry/domain.ts defines
 * `isInRotationGracePeriod(rotatedAt, gracePeriodMs, now)`,
 * `BEARER_ROTATION_GRACE_MS` (24h), and `MTLS_ROTATION_GRACE_MS` (7d) —
 * documented as: "During rotation, both the old and new credentials are
 * accepted for a configurable window: 24 hours for Bearer tokens, 7 days
 * for certificates." These are unit-tested in isolation
 * (device-registry-domain.test.ts's "isInRotationGracePeriod" describe
 * block) but grep across the ENTIRE src tree confirms they are never
 * imported anywhere outside domain.ts and its own test — in particular,
 * device-auth.ts (the actual authentication middleware) never references
 * `tokenRotatedAt`, `isInRotationGracePeriod`, or either grace-period
 * constant, despite `DeviceRecord`/`DeviceContext` carrying
 * `tokenRotatedAt` all the way through.
 *
 * The real enforcement path is repo.ts#getDeviceByTokenHash:
 *   `.where(or(eq(devices.deviceTokenHash, hash), eq(devices.oldTokenHash, hash)))`
 * — an UNCONDITIONAL match against `old_token_hash`, with no time bound
 * applied anywhere downstream in device-auth.ts's `deviceAuth()` (its only
 * expiry check, Step 3, reads `device.tokenExpiresAt` — the CURRENT
 * token's expiry, which `deviceRotateCredential` never sets — not
 * `tokenRotatedAt` + a grace window).
 *
 * Net effect: once a device's Bearer token is rotated (e.g. specifically
 * BECAUSE the old one leaked/was compromised — the normal reason to rotate
 * a credential), the OLD token keeps authenticating successfully FOREVER
 * (until the device is rotated a second time), not just for the documented
 * 24h grace window. This test proves it directly against the real
 * `deviceAuth()` middleware using an old-token rotation timestamp far
 * outside any documented grace period (999 days), following the exact
 * `setDeviceLoader` + `mockRequest`/`mockReply` conventions established in
 * device-auth.test.ts.
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
// MTLS_ROTATION_GRACE_MS (7d). If the grace period were enforced, the old
// token below would be rejected.
const LONG_AGO_ROTATION = new Date(Date.now() - 999 * 24 * 60 * 60 * 1000).toISOString();

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

describe("device-auth — old (rotated) Bearer token grace period", () => {
  beforeEach(async () => {
    resetDeviceAuthForTests();
    await invalidateDeviceCache(OLD_TOKEN_HASH, "token_hash");
    await invalidateDeviceCache(NEW_TOKEN_HASH, "token_hash");
    setDeviceLoader(async (lookupKey) => {
      if (lookupKey === OLD_TOKEN_HASH || lookupKey === NEW_TOKEN_HASH) return rotatedDevice;
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

  it("BUG: the OLD token, rotated 999 days ago, STILL authenticates — no grace-period cutoff is enforced", async () => {
    const req = mockRequest({ authorization: `Bearer ${OLD_RAW_TOKEN}` });

    // A correctly-enforced 24h Bearer grace period would reject this with
    // DEVICE_CREDENTIAL_REVOKED. Instead deviceAuth() authenticates it
    // exactly as if it were still current — the leaked/rotated-away
    // credential never actually stops working.
    await deviceAuth(req, mockReply());
    expect(req.deviceContext?.deviceId).toBe(rotatedDevice.id);
    expect(req.deviceContext?.authType).toBe("bearer_token");
  });
});
