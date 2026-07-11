/**
 * Unit tests for device-auth middleware (preHandler hook).
 *
 * Tests cover:
 *   - Bearer token extraction and hash verification
 *   - mTLS certificate fingerprint extraction
 *   - Device status checks (active, suspended, deregistered)
 *   - Token expiration checks
 *   - Rate limiting (60 req/min printers, 120 req/min turnstiles)
 *   - Location mismatch detection
 *   - DeviceContext binding to request
 *
 * Requirements validated: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 10.1
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
import { HttpError } from "../src/shared/context.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const RAW_TOKEN = "device_abc123xyz456";
const TOKEN_HASH = hashToken(RAW_TOKEN);

const activeDevice: DeviceRecord = {
  id: "d-001",
  tenantId: "t-001",
  locationId: "loc-001",
  gateId: "gate-001",
  deviceType: "printer",
  authType: "bearer_token",
  status: "active",
  deviceTokenHash: TOKEN_HASH,
  oldTokenHash: null,
  certificateFingerprint: null,
  tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(), // +24h
  tokenRotatedAt: null,
};

const activeTurnstile: DeviceRecord = {
  id: "d-002",
  tenantId: "t-001",
  locationId: "loc-001",
  gateId: "gate-002",
  deviceType: "turnstile",
  authType: "mtls",
  status: "active",
  deviceTokenHash: null,
  oldTokenHash: null,
  certificateFingerprint: "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
  tokenExpiresAt: null,
  tokenRotatedAt: null,
};

// ---------------------------------------------------------------------------
// Mock Fastify request/reply
// ---------------------------------------------------------------------------

function mockRequest(opts: {
  authorization?: string;
  hasCert?: boolean;
  certFingerprint?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}) {
  const headers: Record<string, string | undefined> = {
    authorization: opts.authorization,
    ...(opts.headers ?? {}),
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
    body: opts.body ?? null,
    deviceContext: undefined,
  } as unknown as import("fastify").FastifyRequest;
}

function mockReply() {
  return {} as unknown as import("fastify").FastifyReply;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("device-auth middleware", () => {
  beforeEach(async () => {
    resetDeviceAuthForTests();
    // Clear cache entries from previous tests
    await invalidateDeviceCache(TOKEN_HASH, "token_hash");
    await invalidateDeviceCache(
      activeTurnstile.certificateFingerprint!,
      "certificate_fingerprint",
    );
  });

  afterEach(() => {
    resetDeviceAuthForTests();
  });

  describe("hashToken", () => {
    it("produces consistent SHA-256 hex digest", () => {
      const hash = hashToken("device_test123");
      expect(hash).toHaveLength(64); // SHA-256 = 32 bytes = 64 hex chars
      expect(hash).toBe(hashToken("device_test123")); // deterministic
    });

    it("produces different hashes for different tokens", () => {
      expect(hashToken("device_a")).not.toBe(hashToken("device_b"));
    });
  });

  describe("Bearer token auth path", () => {
    it("authenticates valid Bearer token and binds DeviceContext", async () => {
      setDeviceLoader(async (key, type) => {
        if (type === "token_hash" && key === TOKEN_HASH) return activeDevice;
        return null;
      });

      const req = mockRequest({ authorization: `Bearer ${RAW_TOKEN}` });
      const reply = mockReply();

      await deviceAuth(req, reply);

      expect(req.deviceContext).toEqual({
        deviceId: "d-001",
        tenantId: "t-001",
        locationId: "loc-001",
        gateId: "gate-001",
        deviceType: "printer",
        authType: "bearer_token",
      });
    });

    it("rejects requests without Authorization header", async () => {
      setDeviceLoader(async () => null);
      const req = mockRequest({});
      const reply = mockReply();

      await expect(deviceAuth(req, reply)).rejects.toMatchObject({
        status: 401,
        code: "DEVICE_CREDENTIAL_REVOKED",
      });
    });

    it("rejects Bearer tokens that do not start with device_", async () => {
      setDeviceLoader(async () => null);
      const req = mockRequest({ authorization: "Bearer some_other_token" });
      const reply = mockReply();

      await expect(deviceAuth(req, reply)).rejects.toMatchObject({
        status: 401,
        code: "DEVICE_CREDENTIAL_REVOKED",
      });
    });

    it("rejects invalid device tokens not found in DB", async () => {
      setDeviceLoader(async () => null);
      const req = mockRequest({ authorization: "Bearer device_invalid" });
      const reply = mockReply();

      await expect(deviceAuth(req, reply)).rejects.toMatchObject({
        status: 401,
        code: "DEVICE_CREDENTIAL_REVOKED",
      });
    });
  });

  describe("mTLS auth path", () => {
    it("authenticates via client certificate fingerprint", async () => {
      setDeviceLoader(async (key, type) => {
        if (type === "certificate_fingerprint" && key === activeTurnstile.certificateFingerprint) {
          return activeTurnstile;
        }
        return null;
      });

      const req = mockRequest({
        hasCert: true,
        certFingerprint: activeTurnstile.certificateFingerprint!,
      });
      const reply = mockReply();

      await deviceAuth(req, reply);

      expect(req.deviceContext).toEqual({
        deviceId: "d-002",
        tenantId: "t-001",
        locationId: "loc-001",
        gateId: "gate-002",
        deviceType: "turnstile",
        authType: "mtls",
      });
    });

    it("rejects when certificate fingerprint not found", async () => {
      setDeviceLoader(async () => null);
      const req = mockRequest({ hasCert: true, certFingerprint: "FF:FF:FF:FF" });
      const reply = mockReply();

      await expect(deviceAuth(req, reply)).rejects.toMatchObject({
        status: 401,
        code: "DEVICE_CREDENTIAL_REVOKED",
      });
    });
  });

  describe("device status checks", () => {
    it("rejects suspended device with 403 DEVICE_INACTIVE", async () => {
      const suspendedDevice = { ...activeDevice, status: "suspended" };
      setDeviceLoader(async () => suspendedDevice);

      const req = mockRequest({ authorization: `Bearer ${RAW_TOKEN}` });
      const reply = mockReply();

      await expect(deviceAuth(req, reply)).rejects.toMatchObject({
        status: 403,
        code: "DEVICE_INACTIVE",
      });
    });

    it("rejects deregistered device with 403 DEVICE_INACTIVE", async () => {
      const deregisteredDevice = { ...activeDevice, status: "deregistered" };
      setDeviceLoader(async () => deregisteredDevice);

      const req = mockRequest({ authorization: `Bearer ${RAW_TOKEN}` });
      const reply = mockReply();

      await expect(deviceAuth(req, reply)).rejects.toMatchObject({
        status: 403,
        code: "DEVICE_INACTIVE",
      });
    });

    it("rejects pending_activation device with 403 DEVICE_INACTIVE", async () => {
      const pendingDevice = { ...activeDevice, status: "pending_activation" };
      setDeviceLoader(async () => pendingDevice);

      const req = mockRequest({ authorization: `Bearer ${RAW_TOKEN}` });
      const reply = mockReply();

      await expect(deviceAuth(req, reply)).rejects.toMatchObject({
        status: 403,
        code: "DEVICE_INACTIVE",
      });
    });
  });

  describe("token expiration", () => {
    it("rejects expired token with 401 DEVICE_CREDENTIAL_REVOKED", async () => {
      const expiredDevice = {
        ...activeDevice,
        tokenExpiresAt: new Date(Date.now() - 3600000).toISOString(), // -1h
      };
      setDeviceLoader(async () => expiredDevice);

      const req = mockRequest({ authorization: `Bearer ${RAW_TOKEN}` });
      const reply = mockReply();

      await expect(deviceAuth(req, reply)).rejects.toMatchObject({
        status: 401,
        code: "DEVICE_CREDENTIAL_REVOKED",
      });
    });

    it("allows token that has not expired", async () => {
      setDeviceLoader(async () => activeDevice);

      const req = mockRequest({ authorization: `Bearer ${RAW_TOKEN}` });
      const reply = mockReply();

      await deviceAuth(req, reply);
      expect(req.deviceContext).toBeDefined();
    });

    it("skips token expiration check for mTLS devices", async () => {
      setDeviceLoader(async () => activeTurnstile);
      const req = mockRequest({
        hasCert: true,
        certFingerprint: activeTurnstile.certificateFingerprint!,
      });
      const reply = mockReply();

      await deviceAuth(req, reply);
      expect(req.deviceContext?.deviceType).toBe("turnstile");
    });
  });

  describe("rate limiting", () => {
    it("allows up to 60 requests per minute for printers", async () => {
      setDeviceLoader(async () => activeDevice);

      for (let i = 0; i < 60; i++) {
        const req = mockRequest({ authorization: `Bearer ${RAW_TOKEN}` });
        await deviceAuth(req, mockReply());
        expect(req.deviceContext).toBeDefined();
      }

      // 61st request should be rejected
      const req = mockRequest({ authorization: `Bearer ${RAW_TOKEN}` });
      await expect(deviceAuth(req, mockReply())).rejects.toMatchObject({
        status: 429,
        code: "DEVICE_RATE_LIMIT",
      });
    });

    it("allows up to 120 requests per minute for turnstiles", async () => {
      setDeviceLoader(async () => activeTurnstile);

      for (let i = 0; i < 120; i++) {
        const req = mockRequest({
          hasCert: true,
          certFingerprint: activeTurnstile.certificateFingerprint!,
        });
        await deviceAuth(req, mockReply());
        expect(req.deviceContext).toBeDefined();
      }

      // 121st request should be rejected
      const req = mockRequest({
        hasCert: true,
        certFingerprint: activeTurnstile.certificateFingerprint!,
      });
      await expect(deviceAuth(req, mockReply())).rejects.toMatchObject({
        status: 429,
        code: "DEVICE_RATE_LIMIT",
      });
    });
  });

  describe("location mismatch check", () => {
    it("rejects request with x-device-location mismatch", async () => {
      setDeviceLoader(async () => activeDevice);

      const req = mockRequest({
        authorization: `Bearer ${RAW_TOKEN}`,
        headers: { "x-device-location": "loc-999" },
      });
      const reply = mockReply();

      await expect(deviceAuth(req, reply)).rejects.toMatchObject({
        status: 403,
        code: "LOCATION_MISMATCH",
      });
    });

    it("rejects request with body locationId mismatch", async () => {
      setDeviceLoader(async () => activeDevice);

      const req = mockRequest({
        authorization: `Bearer ${RAW_TOKEN}`,
        body: { locationId: "loc-different" },
      });
      const reply = mockReply();

      await expect(deviceAuth(req, reply)).rejects.toMatchObject({
        status: 403,
        code: "LOCATION_MISMATCH",
      });
    });

    it("allows request with matching x-device-location", async () => {
      setDeviceLoader(async () => activeDevice);

      const req = mockRequest({
        authorization: `Bearer ${RAW_TOKEN}`,
        headers: { "x-device-location": "loc-001" },
      });
      const reply = mockReply();

      await deviceAuth(req, reply);
      expect(req.deviceContext).toBeDefined();
    });

    it("skips location check when no location claim is present", async () => {
      setDeviceLoader(async () => activeDevice);

      const req = mockRequest({ authorization: `Bearer ${RAW_TOKEN}` });
      const reply = mockReply();

      await deviceAuth(req, reply);
      expect(req.deviceContext).toBeDefined();
    });
  });
});
