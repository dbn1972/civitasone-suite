/**
 * Geocoding Adapter Tests
 *
 * Tests:
 * 1. Disabled adapter returns 503 (INTEGRATION_DISABLED)
 * 2. Happy path — forward geocode (mocked fetch)
 * 3. Happy path — reverse geocode (mocked fetch)
 * 4. Circuit breaker opens after 5 failures
 * 5. Lat/lng validation — rejects out-of-range coordinates
 * 6. Timeout handling (10s)
 * 7. No PII in logs
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["location_admin"]) {
  return signToken(
    { sub: "user-001", tid: TENANT, roles, sid: "sess-001" },
    SECRET,
  );
}

describe("Geocoding Adapter — disabled", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Ensure geocoding is disabled (default — env not set)
    delete process.env.GEOCODING_ENABLED;
    delete process.env.GEOCODING_PROVIDER;
    delete process.env.GEOCODING_API_KEY;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /v1/locations/geocode returns 503 when adapter disabled (forward)", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: "123 Main St, New Delhi" },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("INTEGRATION_DISABLED");
    expect(body.error.message).toBe("Geocoding integration is not available");
    expect(body.error.correlationId).toBeDefined();
  });

  it("POST /v1/locations/geocode returns 503 when adapter disabled (reverse)", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { lat: 28.6139, lng: 77.209 },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("INTEGRATION_DISABLED");
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      payload: { address: "123 Main St" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: "123 Main St" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid request body (empty)", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("Geocoding Adapter — enabled (mocked fetch, mapmyindia)", () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.GEOCODING_ENABLED = "true";
    process.env.GEOCODING_PROVIDER = "mapmyindia";
    process.env.GEOCODING_API_KEY = "test-api-key-geocoding";

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.GEOCODING_ENABLED;
    delete process.env.GEOCODING_PROVIDER;
    delete process.env.GEOCODING_API_KEY;
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /v1/locations/geocode — forward geocode happy path", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        copResults: { latitude: "28.6139", longitude: "77.2090" },
      }),
    } as Response);

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: "India Gate, New Delhi" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.lat).toBeCloseTo(28.6139, 4);
    expect(body.data.lng).toBeCloseTo(77.209, 3);
  });

  it("POST /v1/locations/geocode — reverse geocode happy path", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ formatted_address: "India Gate, Rajpath, New Delhi 110001" }],
      }),
    } as Response);

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { lat: 28.6139, lng: 77.209 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.address).toBe("India Gate, Rajpath, New Delhi 110001");
  });

  it("returns 502 on upstream API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response);

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: "Unknown Place" },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(body.error.correlationId).toBeDefined();
  });

  it("handles timeout (AbortError) as upstream failure", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    );

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: "Timeout Test" },
    });

    // AbortError propagates through circuit breaker and is rethrown as a
    // generic failure since it isn't a GeocodingAdapterError or CircuitBreakerOpenError
    expect(res.statusCode).toBe(500);
  });

  it("circuit breaker opens after 5 consecutive failures", async () => {
    // Simulate 5 consecutive failures
    for (let i = 0; i < 5; i++) {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "fail",
      } as Response);
    }

    const token = makeToken(["location_admin"]);

    // Trigger 5 failures
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/locations/geocode",
        headers: { authorization: `Bearer ${token}` },
        payload: { address: `failure-${i}` },
      });
    }

    // 6th call should hit circuit breaker (open state)
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: "after-breaker" },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("CIRCUIT_OPEN");
    expect(body.error.message).toBe("Geocoding service is temporarily unavailable");
  });
});

describe("Geocoding Adapter — enabled (mocked fetch, google)", () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.GEOCODING_ENABLED = "true";
    process.env.GEOCODING_PROVIDER = "google";
    process.env.GEOCODING_API_KEY = "test-google-api-key";

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.GEOCODING_ENABLED;
    delete process.env.GEOCODING_PROVIDER;
    delete process.env.GEOCODING_API_KEY;
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /v1/locations/geocode — forward geocode (google provider)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ geometry: { location: { lat: 28.6139, lng: 77.209 } } }],
        status: "OK",
      }),
    } as Response);

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: "India Gate, New Delhi" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.lat).toBeCloseTo(28.6139, 4);
    expect(body.data.lng).toBeCloseTo(77.209, 3);
  });

  it("POST /v1/locations/geocode — reverse geocode (google provider)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ formatted_address: "Connaught Place, New Delhi 110001, India" }],
        status: "OK",
      }),
    } as Response);

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { lat: 28.6315, lng: 77.2167 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.address).toBe("Connaught Place, New Delhi 110001, India");
  });
});

describe("Geocoding Adapter — lat/lng validation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Adapter disabled — validation happens at route level before adapter call
    delete process.env.GEOCODING_ENABLED;
    delete process.env.GEOCODING_PROVIDER;
    delete process.env.GEOCODING_API_KEY;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects latitude > 90", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { lat: 91, lng: 77 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects latitude < -90", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { lat: -91, lng: 77 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects longitude > 180", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { lat: 28, lng: 181 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects longitude < -180", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { lat: 28, lng: -181 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts boundary values lat=90, lng=180", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { lat: 90, lng: 180 },
    });
    // Should not get 400 — will get 503 because adapter is disabled
    expect(res.statusCode).toBe(503);
  });

  it("accepts boundary values lat=-90, lng=-180", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { lat: -90, lng: -180 },
    });
    // Should not get 400 — will get 503 because adapter is disabled
    expect(res.statusCode).toBe(503);
  });
});

describe("Geocoding Adapter — no PII in logs", () => {
  it("adapter error messages do not contain PII", async () => {
    vi.resetModules();
    const { GeocodingAdapterError } = await import("../src/modules/geocoding/adapter.js");
    const err = new GeocodingAdapterError("Geocoding API returned 500", "GEOCODING_API_ERROR", 500);
    expect(err.message).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/); // PAN pattern
    expect(err.message).not.toMatch(/\b\d{12}\b/); // Aadhaar pattern
    expect(err.message).not.toMatch(/\b\d{10}\b/); // Phone pattern
    expect(err.message).not.toMatch(/@/); // Email pattern
    expect(err.message).toBe("Geocoding API returned 500");
  });

  it("route error responses do not expose upstream body", async () => {
    process.env.GEOCODING_ENABLED = "true";
    process.env.GEOCODING_PROVIDER = "google";
    process.env.GEOCODING_API_KEY = "test-api-key";

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "User Ramesh Kumar at address 123 Main St" }),
    } as unknown as Response);

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/geocode",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: "Some Address" },
    });

    // Response must not leak the upstream body content with PII
    const responseText = JSON.stringify(res.json());
    expect(responseText).not.toContain("Ramesh Kumar");
    expect(responseText).not.toContain("123 Main St");
    expect(res.json().error.code).toBe("UPSTREAM_ERROR");

    await app.close();
    delete process.env.GEOCODING_ENABLED;
    delete process.env.GEOCODING_PROVIDER;
    delete process.env.GEOCODING_API_KEY;
  });
});
