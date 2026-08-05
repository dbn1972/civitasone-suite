/**
 * Gap 5 — Canned responses CRUD route tests.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000ca00ed01";
const ACTOR = "cccccccc-3333-4000-8000-0000ca00ed01";

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.canned_responses WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => { await cleanup(); });
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("Gap 5: canned responses", () => {
  let createdId: string;

  it("creates a canned response (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/canned-responses",
      headers: headers(),
      payload: { title: "Welcome", body: "Hello, welcome to our team!", channel: "email", category: "onboarding" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    createdId = res.json().data.id;
    expect(createdId).toBeDefined();
  });

  it("lists canned responses with filter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/canned-responses?category=onboarding",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].title).toBe("Welcome");
  });

  it("gets a canned response by id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/canned-responses/${createdId}`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe("Welcome");
  });

  it("updates a canned response", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/canned-responses/${createdId}`,
      headers: headers(),
      payload: { title: "Welcome v2" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("deletes a canned response (204)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/crm/canned-responses/${createdId}`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(204);
  });

  it("returns 404 for deleted response", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/canned-responses/${createdId}`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("requires authentication (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/canned-responses",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("requires correct role (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/canned-responses",
      headers: headers(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
