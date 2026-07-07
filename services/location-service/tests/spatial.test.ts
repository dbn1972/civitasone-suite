/**
 * Spatial / PostGIS tests for location-service.
 * Tests coordinate validation (lat/lng range enforcement) and nearby query route.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { isValidLatitude, isValidLongitude, isValidCoordinate } from "../src/modules/locations/domain.js";
import { createLocationBody, nearbyQuerySchema } from "../src/modules/locations/validators.js";

// ── Test constants ──────────────────────────────────────────────────────────
const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["location_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

// ══════════════════════════════════════════════════════════════════════════════
// Domain logic: coordinate validation
// ══════════════════════════════════════════════════════════════════════════════
describe("isValidLatitude", () => {
  it("accepts 0 (equator)", () => {
    expect(isValidLatitude(0)).toBe(true);
  });

  it("accepts -90 (south pole)", () => {
    expect(isValidLatitude(-90)).toBe(true);
  });

  it("accepts 90 (north pole)", () => {
    expect(isValidLatitude(90)).toBe(true);
  });

  it("accepts a typical latitude", () => {
    expect(isValidLatitude(20.2961)).toBe(true);
  });

  it("rejects latitude > 90", () => {
    expect(isValidLatitude(90.1)).toBe(false);
  });

  it("rejects latitude < -90", () => {
    expect(isValidLatitude(-90.1)).toBe(false);
  });

  it("rejects latitude = 91", () => {
    expect(isValidLatitude(91)).toBe(false);
  });

  it("rejects latitude = -91", () => {
    expect(isValidLatitude(-91)).toBe(false);
  });
});

describe("isValidLongitude", () => {
  it("accepts 0 (prime meridian)", () => {
    expect(isValidLongitude(0)).toBe(true);
  });

  it("accepts -180 (antimeridian)", () => {
    expect(isValidLongitude(-180)).toBe(true);
  });

  it("accepts 180 (antimeridian)", () => {
    expect(isValidLongitude(180)).toBe(true);
  });

  it("accepts a typical longitude", () => {
    expect(isValidLongitude(85.8245)).toBe(true);
  });

  it("rejects longitude > 180", () => {
    expect(isValidLongitude(180.1)).toBe(false);
  });

  it("rejects longitude < -180", () => {
    expect(isValidLongitude(-180.1)).toBe(false);
  });

  it("rejects longitude = 181", () => {
    expect(isValidLongitude(181)).toBe(false);
  });

  it("rejects longitude = -181", () => {
    expect(isValidLongitude(-181)).toBe(false);
  });
});

describe("isValidCoordinate", () => {
  it("accepts valid (lat, lng) pair", () => {
    expect(isValidCoordinate(20.2961, 85.8245)).toBe(true);
  });

  it("rejects when lat is out of range", () => {
    expect(isValidCoordinate(91, 85)).toBe(false);
  });

  it("rejects when lng is out of range", () => {
    expect(isValidCoordinate(20, 181)).toBe(false);
  });

  it("rejects when both are out of range", () => {
    expect(isValidCoordinate(-91, -181)).toBe(false);
  });

  it("accepts boundary values (-90, -180)", () => {
    expect(isValidCoordinate(-90, -180)).toBe(true);
  });

  it("accepts boundary values (90, 180)", () => {
    expect(isValidCoordinate(90, 180)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Zod validator: createLocationBody with lat/lng
// ══════════════════════════════════════════════════════════════════════════════
describe("createLocationBody with coordinates", () => {
  it("accepts body with valid latitude and longitude", () => {
    const body = createLocationBody.parse({
      name: "Bhubaneswar Office",
      latitude: 20.2961,
      longitude: 85.8245,
    });
    expect(body.latitude).toBe(20.2961);
    expect(body.longitude).toBe(85.8245);
  });

  it("accepts body without coordinates (optional)", () => {
    const body = createLocationBody.parse({ name: "No Coords Office" });
    expect(body.latitude).toBeUndefined();
    expect(body.longitude).toBeUndefined();
  });

  it("accepts boundary latitude = -90", () => {
    const body = createLocationBody.parse({ name: "South Pole", latitude: -90, longitude: 0 });
    expect(body.latitude).toBe(-90);
  });

  it("accepts boundary latitude = 90", () => {
    const body = createLocationBody.parse({ name: "North Pole", latitude: 90, longitude: 0 });
    expect(body.latitude).toBe(90);
  });

  it("accepts boundary longitude = -180", () => {
    const body = createLocationBody.parse({ name: "Antimeridian West", latitude: 0, longitude: -180 });
    expect(body.longitude).toBe(-180);
  });

  it("accepts boundary longitude = 180", () => {
    const body = createLocationBody.parse({ name: "Antimeridian East", latitude: 0, longitude: 180 });
    expect(body.longitude).toBe(180);
  });

  it("rejects latitude > 90", () => {
    expect(() =>
      createLocationBody.parse({ name: "Invalid", latitude: 90.1, longitude: 0 })
    ).toThrow();
  });

  it("rejects latitude < -90", () => {
    expect(() =>
      createLocationBody.parse({ name: "Invalid", latitude: -90.1, longitude: 0 })
    ).toThrow();
  });

  it("rejects longitude > 180", () => {
    expect(() =>
      createLocationBody.parse({ name: "Invalid", latitude: 0, longitude: 180.1 })
    ).toThrow();
  });

  it("rejects longitude < -180", () => {
    expect(() =>
      createLocationBody.parse({ name: "Invalid", latitude: 0, longitude: -180.1 })
    ).toThrow();
  });

  it("rejects latitude = 91", () => {
    expect(() =>
      createLocationBody.parse({ name: "Invalid", latitude: 91, longitude: 0 })
    ).toThrow();
  });

  it("rejects longitude = 200", () => {
    expect(() =>
      createLocationBody.parse({ name: "Invalid", latitude: 0, longitude: 200 })
    ).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Zod validator: nearbyQuerySchema
// ══════════════════════════════════════════════════════════════════════════════
describe("nearbyQuerySchema", () => {
  it("parses valid nearby query", () => {
    const q = nearbyQuerySchema.parse({ lat: "20.2961", lng: "85.8245", radiusKm: "5" });
    expect(q.lat).toBe(20.2961);
    expect(q.lng).toBe(85.8245);
    expect(q.radiusKm).toBe(5);
    expect(q.limit).toBe(50); // default
  });

  it("uses defaults for radiusKm and limit", () => {
    const q = nearbyQuerySchema.parse({ lat: "20", lng: "85" });
    expect(q.radiusKm).toBe(10);
    expect(q.limit).toBe(50);
  });

  it("rejects lat > 90", () => {
    expect(() => nearbyQuerySchema.parse({ lat: "91", lng: "0" })).toThrow();
  });

  it("rejects lat < -90", () => {
    expect(() => nearbyQuerySchema.parse({ lat: "-91", lng: "0" })).toThrow();
  });

  it("rejects lng > 180", () => {
    expect(() => nearbyQuerySchema.parse({ lat: "0", lng: "181" })).toThrow();
  });

  it("rejects lng < -180", () => {
    expect(() => nearbyQuerySchema.parse({ lat: "0", lng: "-181" })).toThrow();
  });

  it("rejects radiusKm = 0", () => {
    expect(() => nearbyQuerySchema.parse({ lat: "0", lng: "0", radiusKm: "0" })).toThrow();
  });

  it("rejects radiusKm > 500", () => {
    expect(() => nearbyQuerySchema.parse({ lat: "0", lng: "0", radiusKm: "501" })).toThrow();
  });

  it("rejects limit > 200", () => {
    expect(() => nearbyQuerySchema.parse({ lat: "0", lng: "0", limit: "201" })).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/locations — Create with coordinates
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/locations with coordinates", () => {
  it("→ 202 with valid lat/lng", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Spatial Office", latitude: 20.2961, longitude: 85.8245 },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("→ 202 with boundary lat=-90 lng=-180", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "South West Corner", latitude: -90, longitude: -180 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 202 with boundary lat=90 lng=180", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "North East Corner", latitude: 90, longitude: 180 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 400 with lat > 90", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Bad Lat", latitude: 91, longitude: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("→ 400 with lat < -90", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Bad Lat", latitude: -91, longitude: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 with lng > 180", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Bad Lng", latitude: 0, longitude: 181 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 with lng < -180", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Bad Lng", latitude: 0, longitude: -181 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 202 without coordinates (optional)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "No Coords Office" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 200 created location includes lat/lng in response from cache", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Cached Spatial", latitude: 28.6139, longitude: 77.209 },
    });
    expect(createRes.statusCode).toBe(202);
    const { id } = createRes.json();

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/locations/${id}`,
      headers: authHeader(),
    });
    expect(getRes.statusCode).toBe(200);
    const loc = getRes.json();
    expect(loc.latitude).toBe(28.6139);
    expect(loc.longitude).toBe(77.209);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/locations/nearby — Spatial query
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/locations/nearby", () => {
  it("→ 400 missing lat", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations/nearby?lng=85&radiusKm=5",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 missing lng", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations/nearby?lat=20&radiusKm=5",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 lat > 90", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations/nearby?lat=91&lng=85&radiusKm=5",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 lng > 180", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations/nearby?lat=20&lng=181&radiusKm=5",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations/nearby?lat=20&lng=85&radiusKm=5",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations/nearby?lat=20&lng=85&radiusKm=5",
    });
    expect(res.statusCode).toBe(401);
  });
});
