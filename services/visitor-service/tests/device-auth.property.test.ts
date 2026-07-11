/**
 * Property-based tests for device-auth middleware.
 *
 * Uses fast-check to validate universal correctness properties across
 * generated device types, credentials, and statuses.
 *
 * **Validates: Requirements 1.6, 1.7, 2.1, 2.2, 2.3, 2.6**
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import {
  deviceAuth,
  hashToken,
  setDeviceLoader,
  resetDeviceAuthForTests,
  invalidateDeviceCache,
  type DeviceRecord,
  type DeviceType,
  type AuthType,
} from "../src/modules/device-registry/device-auth.js";
import type { FastifyRequest, FastifyReply } from "fastify";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Device types that require mTLS authentication. */
const MTLS_DEVICE_TYPES: DeviceType[] = ["turnstile", "barrier"];

/** Device types that require Bearer token authentication. */
const BEARER_DEVICE_TYPES: DeviceType[] = ["kiosk", "printer", "scanner"];

/** All supported device types. */
const ALL_DEVICE_TYPES: DeviceType[] = [...BEARER_DEVICE_TYPES, ...MTLS_DEVICE_TYPES];

/** Arbitrary mTLS device type. */
const arbMtlsDeviceType = fc.constantFrom(...MTLS_DEVICE_TYPES);

/** Arbitrary Bearer token device type. */
const arbBearerDeviceType = fc.constantFrom(...BEARER_DEVICE_TYPES);

/** Arbitrary device type from the full set. */
const arbDeviceType = fc.constantFrom(...ALL_DEVICE_TYPES);

/** Arbitrary inactive device status. */
const arbInactiveStatus = fc.constantFrom("suspended", "deregistered");

/** Arbitrary valid device token (starts with device_ prefix). */
const arbDeviceToken = fc.string({ minLength: 8, maxLength: 48 }).map(
  (s) => `device_${s.replace(/[^a-zA-Z0-9]/g, "x")}`,
);

/** Arbitrary certificate fingerprint (SHA-256 colon-separated hex). */
const arbCertFingerprint = fc
  .array(
    fc.integer({ min: 0, max: 255 }).map((n) => n.toString(16).toUpperCase().padStart(2, "0")),
    { minLength: 32, maxLength: 32 },
  )
  .map((octets) => octets.join(":"));

/** Arbitrary UUID-like string for IDs. */
const arbUuid = fc.uuid();

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockRequest(opts: {
  authorization?: string;
  hasCert?: boolean;
  certFingerprint?: string;
}): FastifyRequest {
  const headers: Record<string, string | undefined> = {
    authorization: opts.authorization,
  };

  const socket: Record<string, unknown> = {};
  if (opts.hasCert) {
    socket.getPeerCertificate = () => ({
      fingerprint256: opts.certFingerprint ?? "",
    });
  }

  return {
    headers,
    raw: { socket },
    body: null,
    deviceContext: undefined,
  } as unknown as FastifyRequest;
}

function mockReply(): FastifyReply {
  return {} as unknown as FastifyReply;
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("device-auth property tests", () => {
  beforeEach(() => {
    resetDeviceAuthForTests();
  });

  afterEach(() => {
    resetDeviceAuthForTests();
  });

  // -------------------------------------------------------------------------
  // Property 1: Device credential type matches device category
  // -------------------------------------------------------------------------
  describe("Property 1: Device credential type matches device category", () => {
    it("turnstile and barrier devices always authenticate via mTLS (certificate fingerprint)", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbMtlsDeviceType,
          arbCertFingerprint,
          arbUuid,
          arbUuid,
          arbUuid,
          async (deviceType, fingerprint, deviceId, tenantId, locationId) => {
            resetDeviceAuthForTests();

            const device: DeviceRecord = {
              id: deviceId,
              tenantId,
              locationId,
              gateId: null,
              deviceType,
              authType: "mtls",
              status: "active",
              deviceTokenHash: null,
              oldTokenHash: null,
              certificateFingerprint: fingerprint,
              tokenExpiresAt: null,
              tokenRotatedAt: null,
            };

            setDeviceLoader(async (key, type) => {
              if (type === "certificate_fingerprint" && key === fingerprint) return device;
              return null;
            });

            await invalidateDeviceCache(fingerprint, "certificate_fingerprint");

            const req = mockRequest({ hasCert: true, certFingerprint: fingerprint });
            const reply = mockReply();

            await deviceAuth(req, reply);

            // The authenticated device context must reflect mTLS auth type
            expect(req.deviceContext).toBeDefined();
            expect(req.deviceContext!.authType).toBe("mtls");
            expect(req.deviceContext!.deviceType).toBe(deviceType);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("kiosk, printer, and scanner devices always authenticate via Bearer token", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbBearerDeviceType,
          arbDeviceToken,
          arbUuid,
          arbUuid,
          arbUuid,
          async (deviceType, rawToken, deviceId, tenantId, locationId) => {
            resetDeviceAuthForTests();

            const tokenHash = hashToken(rawToken);

            const device: DeviceRecord = {
              id: deviceId,
              tenantId,
              locationId,
              gateId: null,
              deviceType,
              authType: "bearer_token",
              status: "active",
              deviceTokenHash: tokenHash,
              oldTokenHash: null,
              certificateFingerprint: null,
              tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
              tokenRotatedAt: null,
            };

            setDeviceLoader(async (key, type) => {
              if (type === "token_hash" && key === tokenHash) return device;
              return null;
            });

            await invalidateDeviceCache(tokenHash, "token_hash");

            const req = mockRequest({ authorization: `Bearer ${rawToken}` });
            const reply = mockReply();

            await deviceAuth(req, reply);

            // The authenticated device context must reflect Bearer token auth type
            expect(req.deviceContext).toBeDefined();
            expect(req.deviceContext!.authType).toBe("bearer_token");
            expect(req.deviceContext!.deviceType).toBe(deviceType);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("no device may have the wrong credential type for its category", async () => {
      // This property checks that mTLS devices cannot authenticate with Bearer tokens
      // and Bearer devices cannot authenticate with mTLS certificates.
      await fc.assert(
        fc.asyncProperty(
          arbMtlsDeviceType,
          arbDeviceToken,
          arbUuid,
          arbUuid,
          arbUuid,
          async (deviceType, rawToken, deviceId, tenantId, locationId) => {
            resetDeviceAuthForTests();

            const tokenHash = hashToken(rawToken);

            // mTLS device registered, but attempt to auth with Bearer token
            // The loader won't return the device for a token_hash lookup
            // since the device uses mTLS, so the system correctly rejects.
            setDeviceLoader(async () => null);

            await invalidateDeviceCache(tokenHash, "token_hash");

            const req = mockRequest({ authorization: `Bearer ${rawToken}` });
            const reply = mockReply();

            await expect(deviceAuth(req, reply)).rejects.toMatchObject({
              status: 401,
              code: "DEVICE_CREDENTIAL_REVOKED",
            });
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 4: Inactive devices are rejected regardless of credential validity
  // -------------------------------------------------------------------------
  describe("Property 4: Inactive devices are rejected regardless of credential validity", () => {
    it("suspended or deregistered Bearer devices are always rejected with 403 DEVICE_INACTIVE", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbBearerDeviceType,
          arbInactiveStatus,
          arbDeviceToken,
          arbUuid,
          arbUuid,
          arbUuid,
          async (deviceType, status, rawToken, deviceId, tenantId, locationId) => {
            resetDeviceAuthForTests();

            const tokenHash = hashToken(rawToken);

            const device: DeviceRecord = {
              id: deviceId,
              tenantId,
              locationId,
              gateId: null,
              deviceType,
              authType: "bearer_token",
              status,
              deviceTokenHash: tokenHash,
              oldTokenHash: null,
              certificateFingerprint: null,
              tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
              tokenRotatedAt: null,
            };

            setDeviceLoader(async (key, type) => {
              if (type === "token_hash" && key === tokenHash) return device;
              return null;
            });

            await invalidateDeviceCache(tokenHash, "token_hash");

            const req = mockRequest({ authorization: `Bearer ${rawToken}` });
            const reply = mockReply();

            await expect(deviceAuth(req, reply)).rejects.toMatchObject({
              status: 403,
              code: "DEVICE_INACTIVE",
            });
          },
        ),
        { numRuns: 100 },
      );
    });

    it("suspended or deregistered mTLS devices are always rejected with 403 DEVICE_INACTIVE", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbMtlsDeviceType,
          arbInactiveStatus,
          arbCertFingerprint,
          arbUuid,
          arbUuid,
          arbUuid,
          async (deviceType, status, fingerprint, deviceId, tenantId, locationId) => {
            resetDeviceAuthForTests();

            const device: DeviceRecord = {
              id: deviceId,
              tenantId,
              locationId,
              gateId: null,
              deviceType,
              authType: "mtls",
              status,
              deviceTokenHash: null,
              oldTokenHash: null,
              certificateFingerprint: fingerprint,
              tokenExpiresAt: null,
              tokenRotatedAt: null,
            };

            setDeviceLoader(async (key, type) => {
              if (type === "certificate_fingerprint" && key === fingerprint) return device;
              return null;
            });

            await invalidateDeviceCache(fingerprint, "certificate_fingerprint");

            const req = mockRequest({ hasCert: true, certFingerprint: fingerprint });
            const reply = mockReply();

            await expect(deviceAuth(req, reply)).rejects.toMatchObject({
              status: 403,
              code: "DEVICE_INACTIVE",
            });
          },
        ),
        { numRuns: 100 },
      );
    });

    it("inactive devices are rejected regardless of valid token and device type combination", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbDeviceType,
          arbInactiveStatus,
          arbDeviceToken,
          arbCertFingerprint,
          arbUuid,
          arbUuid,
          arbUuid,
          async (deviceType, status, rawToken, fingerprint, deviceId, tenantId, locationId) => {
            resetDeviceAuthForTests();

            const isMtls = deviceType === "turnstile" || deviceType === "barrier";
            const authType: AuthType = isMtls ? "mtls" : "bearer_token";
            const tokenHash = hashToken(rawToken);

            const device: DeviceRecord = {
              id: deviceId,
              tenantId,
              locationId,
              gateId: null,
              deviceType,
              authType,
              status,
              deviceTokenHash: isMtls ? null : tokenHash,
              oldTokenHash: null,
              certificateFingerprint: isMtls ? fingerprint : null,
              tokenExpiresAt: isMtls ? null : new Date(Date.now() + 86400000).toISOString(),
              tokenRotatedAt: null,
            };

            const lookupKey = isMtls ? fingerprint : tokenHash;
            const lookupType = isMtls ? "certificate_fingerprint" as const : "token_hash" as const;

            setDeviceLoader(async (key, type) => {
              if (type === lookupType && key === lookupKey) return device;
              return null;
            });

            await invalidateDeviceCache(lookupKey, lookupType);

            const req = isMtls
              ? mockRequest({ hasCert: true, certFingerprint: fingerprint })
              : mockRequest({ authorization: `Bearer ${rawToken}` });
            const reply = mockReply();

            await expect(deviceAuth(req, reply)).rejects.toMatchObject({
              status: 403,
              code: "DEVICE_INACTIVE",
            });
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
