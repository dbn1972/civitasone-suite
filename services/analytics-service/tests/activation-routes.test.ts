/**
 * Activation routes — POST event recording + GET funnel read + platform funnel.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-3333-4000-8000-000000000099";

function makeToken(roles: string[] = ["tenant_admin"], tenantId = TENANT) {
  return signToken({ sub: "user-act-01", tid: tenantId, roles, sid: "sess-act-01" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/analytics/activation/events", () => {
  it("rejects invalid step with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/activation/events",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { step: "invalid_step" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects request without token with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/activation/events",
      headers: { "content-type": "application/json" },
      payload: { step: "signin" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("rejects empty body with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/activation/events",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects extra fields (strict mode) with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/activation/events",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { step: "signin", extra: "bad" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/analytics/activation/funnel", () => {
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/activation/funnel" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/analytics/activation/funnel/platform", () => {
  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/activation/funnel/platform",
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/activation/funnel/platform" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
