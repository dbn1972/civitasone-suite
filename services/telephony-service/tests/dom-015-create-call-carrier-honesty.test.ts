/**
 * DOM-015 — POST /v1/telephony/calls must not return the same "accepted"
 * shape for a real carrier dial and a mock/no-op one.
 *
 * Before this fix, `createCall`'s response was `{id, status, correlationId}`
 * in every case: carrier configured and dial succeeded, carrier configured
 * and dial failed, and carrier not configured at all (the default —
 * `TELEPHONY_CARRIER` unset). A caller had no field to tell them apart.
 *
 * `../../src/shared/carrier-adapter.js` reads `TELEPHONY_CARRIER` at module
 * load time (a top-level `const`), so flipping the env var per-test would be
 * a no-op once the module has been imported. This mocks the adapter directly
 * instead, which also keeps the test offline (no real Twilio/Exotel call).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const mockDial = vi.fn();
const mockIsConfigured = vi.fn();

vi.mock("../src/shared/carrier-adapter.js", () => ({
  dial: (...args: unknown[]) => mockDial(...args),
  isConfigured: () => mockIsConfigured(),
}));

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000dd";

function authHeader() {
  const jwt = signToken({ sub: "user-dom015", tid: TENANT, roles: ["telephony_user"] }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;
let sqlClient: { end: () => Promise<void> };

beforeAll(async () => {
  const appMod = await import("../src/app.js");
  const dbMod = await import("../src/shared/db.js");
  app = await appMod.buildApp();
  sqlClient = dbMod.sqlClient;
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

beforeEach(() => {
  mockDial.mockReset();
  mockIsConfigured.mockReset();
});

describe("POST /v1/telephony/calls — carrier mode honesty (DOM-015)", () => {
  it("marks a call as carrierMode: mock when no real carrier is configured (the default)", async () => {
    mockIsConfigured.mockReturnValue(false);
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/calls",
      headers: authHeader(),
      payload: { direction: "outbound", callerNumber: "9876500001", calleeNumber: "9876500002" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.carrierMode).toBe("mock");
    expect(body.data.carrier).toBeUndefined();
    expect(mockDial).not.toHaveBeenCalled();
  });

  it("marks a call as carrierMode: live and names the carrier on a real successful dial", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDial.mockResolvedValue({ carrierCallId: "CA-real-123", status: "queued", carrier: "twilio" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/calls",
      headers: authHeader(),
      payload: { direction: "outbound", callerNumber: "9876500001", calleeNumber: "9876500003" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.carrierMode).toBe("live");
    expect(body.data.carrier).toBe("twilio");
  });

  it("marks a call as carrierMode: dial_failed (never 'accepted' as if it rang) when the carrier errors", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDial.mockRejectedValue(new Error("carrier timeout"));
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/calls",
      headers: authHeader(),
      payload: { direction: "outbound", callerNumber: "9876500001", calleeNumber: "9876500004" },
    });
    // The command still 202s (the call record itself is real and was created);
    // only the carrier-interaction signal reflects the failure.
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.carrierMode).toBe("dial_failed");
    expect(body.data.carrier).toBeUndefined();
  });

  it("marks carrierMode: not_applicable for an inbound call (no dial is ever attempted)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/calls",
      headers: authHeader(),
      payload: { direction: "inbound", callerNumber: "9876500005" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.carrierMode).toBe("not_applicable");
    expect(mockIsConfigured).not.toHaveBeenCalled();
  });
});
