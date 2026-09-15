/**
 * COMP-007 -- asset-service smoke tests for four zero-test modules: streetlight,
 * water-connections, water-metering, water-tanker. All four are registered in
 * app.ts and are real command/domain/repo modules (not thin CRUD wrappers), but
 * before this file had zero test references anywhere in the service.
 *
 * One real request per module through the real app + a real disposable
 * Postgres: a role-gated create (or list, where create needs a pre-existing
 * FK row this smoke test doesn't set up) and a 401/403 check.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000199";

function makeToken(roles: string[], sub = "user-comp007-asset") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-comp007-asset" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

describe("COMP-007: streetlight -- POST /v1/assets/streetlights", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/assets/streetlights", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the streetlight ACL", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/assets/streetlights",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("creates a real streetlight for an authorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/assets/streetlights",
      headers: { authorization: `Bearer ${makeToken(["streetlight_admin"])}` },
      payload: { poleId: "SL-COMP007-001", lampType: "led", wattage: 90 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("id");
  });
});

describe("COMP-007: water-connections -- POST /v1/assets/water/applications", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/assets/water/applications", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("creates a real water-connection application for an authorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/assets/water/applications",
      headers: { authorization: `Bearer ${makeToken(["water_admin"])}` },
      payload: { applicantName: "COMP-007 Smoke Test", applicantPhone: "9876500000", connectionType: "domestic" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("id");
  });
});

describe("COMP-007: water-tanker -- POST /v1/assets/water/tanker-bookings", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/assets/water/tanker-bookings", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("creates a real tanker booking for an authorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/assets/water/tanker-bookings",
      headers: { authorization: `Bearer ${makeToken(["water_operator"])}` },
      payload: { tankerCapacityLitres: 5000, requestedDate: "2026-09-20" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("id");
  });
});

describe("COMP-007: water-metering -- GET /v1/assets/water/readings", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/assets/water/readings" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  // KNOWN ISSUE (found by this smoke test, not fixed here -- real migration
  // authoring is out of COMP-007's scope): `water-metering/schema.ts` declares
  // `pgSchema("water_metering").table("asset_water_meter_readings", ...)` (and
  // the sibling bills / service-requests tables), but NO migration under
  // services/asset-service/migrations/ ever creates a `water_metering` schema
  // or any table in it -- confirmed by grepping every migration file. The
  // module (routes + domain + repo + commands, 315 LOC) is fully wired into
  // app.ts and looks complete, but every request against it hits a real
  // Postgres and gets `relation "water_metering.asset_water_meter_readings"
  // does not exist`. This is very likely why it had zero tests: it has never
  // been possible to write one that passes end-to-end. Asserting the real,
  // current behavior so this test documents the gap instead of hiding it;
  // flagged separately as a higher-priority follow-up than COMP-007 itself.
  it("KNOWN ISSUE: 500s -- the water_metering schema was never migrated", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/assets/water/readings",
      headers: { authorization: `Bearer ${makeToken(["water_admin"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(500);
  });
});
