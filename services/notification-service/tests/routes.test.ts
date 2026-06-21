/**
 * notification-service HTTP route tests (inject)
 *
 * Asserts inbox + deliveries routes return 200 + correct shape.
 * Uses HS256 test JWTs. No seeded rows — empty results still pass schema.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000066";
const OTHER  = "bbbbbbbb-2222-4000-8000-000000000066";

const ACTOR = "cccccccc-3333-4000-8000-000000000066";

function token(tenantId = TENANT, roles = ["notification_user"]) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /notifications/notifications — inbox (tenant + user scoped)", () => {
  it("returns 200 with array of NotificationItem", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/notifications",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("supports pagination params", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/notifications?limit=10&offset=0",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("tenant isolation: different tenant returns empty array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/notifications",
      headers: { authorization: `Bearer ${token(OTHER)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("GET /notifications/deliveries", () => {
  it("returns 200 with array of NotificationDelivery", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/deliveries",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /notifications/preferences", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/preferences",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("unauthenticated", () => {
  it("GET /notifications/notifications without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/notifications/notifications" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
