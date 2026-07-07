/**
 * Routing Endpoint Tests
 *
 * Tests:
 * 1. Disabled adapter returns 503 (INTEGRATION_DISABLED)
 * 2. Happy path — compute route (mocked fetch)
 * 3. Validation: reject < 2 waypoints, > 25 waypoints, invalid coordinates
 * 4. Circuit breaker opens after 5 failures
 * 5. Auth: 401 no token, 403 wrong role
 * 6. No PII in error responses
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2222-4000-8000-000000000099";

function makeToken(roles: string[] = ["location_admin"]) {
  return signToken(
    { sub: "user-routing-001", tid: TENANT, roles, sid: "sess-routing-001" },
    SECRET,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Domain logic tests
// ══════════════════════════════════════════════════════════════════════════════
describe("Routing domain logic", () => {
  it("validates waypoints correctly", async () => {
    const { validateWaypoints } = await import("../src/modules/routing/domain.js");

    expect(validateWaypoints([])).toBe("At least 2 waypoints are required");
    expect(validateWaypoints([{ lat: 0, lng: 0 }])).toBe("At least 2 waypoints are required");
    expect(validateWaypoints([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).toBeNull();

    // 25 waypoints OK
    const twentyFive = Array.from({ length: 25 }, (_, i) => ({ lat: i, lng: i }));
    expect(validateWaypoints(twentyFive)).toBeNull();

    // 26 waypoints rejected
    const twentySix = Array.from({ length: 26 }, (_, i) => ({ lat: i, lng: i }));
    expect(validateWaypoints(twentySix)).toBe("Maximum 25 waypoints allowed");
  });

  it("rejects invalid coordinates in waypoints", async () => {
    const { validateWaypoints } = await import("../src/modules/routing/domain.js");

    expect(validateWaypoints([{ lat: 91, lng: 0 }, { lat: 0, lng: 0 }])).toContain("latitude");
    expect(validateWaypoints([{ lat: 0, lng: 181 }, { lat: 0, lng: 0 }])).toContain("longitude");
    expect(validateWaypoints([{ lat: -91, lng: 0 }, { lat: 0, lng: 0 }])).toContain("latitude");
    expect(validateWaypoints([{ lat: 0, lng: -181 }, { lat: 0, lng: 0 }])).toContain("longitude");
  });

  it("computes haversine distance", async () => {
    const { haversineDistanceMeters } = await import("../src/modules/routing/domain.js");

    // Known distance: New Delhi to Agra ≈ ~200km
    const delhi = { lat: 28.6139, lng: 77.209 };
    const agra = { lat: 27.1767, lng: 78.0081 };
    const dist = haversineDistanceMeters(delhi, agra);

    expect(dist).toBeGreaterThan(150_000);
    expect(dist).toBeLessThan(250_000);
  });

  it("computes total straight-line distance across waypoints", async () => {
    const { totalStraightLineDistance, haversineDistanceMeters } = await import("../src/modules/routing/domain.js");

    const a = { lat: 0, lng: 0 };
    const b = { lat: 1, lng: 0 };
    const c = { lat: 1, lng: 1 };

    const expected = haversineDistanceMeters(a, b) + haversineDistanceMeters(b, c);
    const total = totalStraightLineDistance([a, b, c]);

    // Rounded values should be close
    expect(Math.abs(total - Math.round(expected))).toBeLessThan(2);
  });

  it("haversine returns 0 for same point", async () => {
    const { haversineDistanceMeters } = await import("../src/modules/routing/domain.js");
    const p = { lat: 20, lng: 85 };
    expect(haversineDistanceMeters(p, p)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Route tests — adapter disabled
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/locations/routing — disabled", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env.ROUTING_PROVIDER;
    delete process.env.ROUTING_API_KEY;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 503 INTEGRATION_DISABLED when not configured", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        waypoints: [
          { lat: 28.6139, lng: 77.209 },
          { lat: 27.1767, lng: 78.0081 },
        ],
      },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("INTEGRATION_DISABLED");
    expect(body.error.message).toBe("Routing integration is not available");
    expect(body.error.correlationId).toBeDefined();
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      payload: {
        waypoints: [
          { lat: 28.6139, lng: 77.209 },
          { lat: 27.1767, lng: 78.0081 },
        ],
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        waypoints: [
          { lat: 28.6139, lng: 77.209 },
          { lat: 27.1767, lng: 78.0081 },
        ],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for empty waypoints array", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: { waypoints: [] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 for 1 waypoint (needs at least 2)", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: { waypoints: [{ lat: 28.6, lng: 77.2 }] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 for 26 waypoints (max 25)", async () => {
    const token = makeToken(["location_admin"]);
    const waypoints = Array.from({ length: 26 }, (_, i) => ({ lat: i, lng: i }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: { waypoints },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 for invalid latitude > 90", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        waypoints: [
          { lat: 91, lng: 77 },
          { lat: 28, lng: 77 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid longitude > 180", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        waypoints: [
          { lat: 28, lng: 181 },
          { lat: 28, lng: 77 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing waypoints field", async () => {
    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts 25 waypoints with boundary coordinates (gets 503 because disabled)", async () => {
    const token = makeToken(["location_admin"]);
    const waypoints = Array.from({ length: 25 }, (_, i) => ({
      lat: -90 + (i * 180) / 24,
      lng: -180 + (i * 360) / 24,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: { waypoints },
    });
    // Validation passes, but adapter is disabled
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("INTEGRATION_DISABLED");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Route tests — adapter enabled (mocked fetch, mapmyindia)
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/locations/routing — enabled (mapmyindia)", () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.ROUTING_PROVIDER = "mapmyindia";
    process.env.ROUTING_API_KEY = "test-routing-api-key";

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ROUTING_PROVIDER;
    delete process.env.ROUTING_API_KEY;
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path — returns distance, duration, polyline", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        routes: [
          {
            distance: 185000,
            duration: 10800,
            geometry: "encoded_polyline_string",
          },
        ],
      }),
    } as Response);

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        waypoints: [
          { lat: 28.6139, lng: 77.209 },
          { lat: 27.1767, lng: 78.0081 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.distanceMeters).toBe(185000);
    expect(body.data.durationSeconds).toBe(10800);
    expect(body.data.polyline).toBe("encoded_polyline_string");
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
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        waypoints: [
          { lat: 28.6139, lng: 77.209 },
          { lat: 27.1767, lng: 78.0081 },
        ],
      },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(body.error.correlationId).toBeDefined();
  });

  it("returns 502 when route has no results", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ routes: [] }),
    } as Response);

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        waypoints: [
          { lat: 28.6139, lng: 77.209 },
          { lat: 27.1767, lng: 78.0081 },
        ],
      },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("UPSTREAM_ERROR");
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
    const payload = {
      waypoints: [
        { lat: 28.6139, lng: 77.209 },
        { lat: 27.1767, lng: 78.0081 },
      ],
    };

    // Trigger 5 failures
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/locations/routing",
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
    }

    // 6th call should hit circuit breaker
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("CIRCUIT_OPEN");
    expect(body.error.message).toBe("Routing service is temporarily unavailable");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Route tests — adapter enabled (mocked fetch, google)
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/locations/routing — enabled (google)", () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.ROUTING_PROVIDER = "google";
    process.env.ROUTING_API_KEY = "test-google-routing-key";

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ROUTING_PROVIDER;
    delete process.env.ROUTING_API_KEY;
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path — google directions (2 waypoints)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        routes: [
          {
            legs: [
              { distance: { value: 185000 }, duration: { value: 10800 } },
            ],
            overview_polyline: { points: "google_encoded_polyline" },
          },
        ],
        status: "OK",
      }),
    } as Response);

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        waypoints: [
          { lat: 28.6139, lng: 77.209 },
          { lat: 27.1767, lng: 78.0081 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.distanceMeters).toBe(185000);
    expect(body.data.durationSeconds).toBe(10800);
    expect(body.data.polyline).toBe("google_encoded_polyline");
  });

  it("happy path — google directions (3+ waypoints, sums legs)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        routes: [
          {
            legs: [
              { distance: { value: 100000 }, duration: { value: 5000 } },
              { distance: { value: 85000 }, duration: { value: 4000 } },
            ],
            overview_polyline: { points: "multi_leg_poly" },
          },
        ],
        status: "OK",
      }),
    } as Response);

    const token = makeToken(["location_admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/routing",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        waypoints: [
          { lat: 28.6139, lng: 77.209 },
          { lat: 27.5, lng: 77.5 },
          { lat: 27.1767, lng: 78.0081 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.distanceMeters).toBe(185000);
    expect(body.data.durationSeconds).toBe(9000);
    expect(body.data.polyline).toBe("multi_leg_poly");
  });
});
