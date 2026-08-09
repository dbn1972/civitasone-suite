/**
 * Grant Service — Route-Level RBAC + Validation Tests.
 *
 * Source: modules/application/routes.ts, modules/scheme/routes.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "dd440001-1111-4000-8000-000000gr0001";
const ACTOR = "dd44aaaa-1111-4000-8000-000000gr000a";
const SCHEME_ID = "dd441111-1111-4000-8000-000000000001";
const APP_ID = "dd442222-1111-4000-8000-000000000001";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-gr" }, SECRET, 3600);
}
const grantOfficer = () => ({ authorization: `Bearer ${token(["grant_officer"])}` });
const unrelated = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/grants/schemes/:id/applications — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/grants/schemes/${SCHEME_ID}/applications`, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/grants/schemes/${SCHEME_ID}/applications`,
      headers: unrelated(), payload: { beneficiaryId: ACTOR },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for missing payload with grant_officer", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/grants/schemes/${SCHEME_ID}/applications`,
      headers: grantOfficer(), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for non-UUID scheme id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/grants/schemes/bad-id/applications",
      headers: grantOfficer(), payload: { beneficiaryId: ACTOR },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /v1/grants/applications/:id/approve — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/grants/applications/${APP_ID}/approve`, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/grants/applications/${APP_ID}/approve`,
      headers: unrelated(), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/grants/applications/:id/reject — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/grants/applications/${APP_ID}/reject`, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/grants/applications/${APP_ID}/reject`,
      headers: unrelated(), payload: { reason: "Not eligible" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
