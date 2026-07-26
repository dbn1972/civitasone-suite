/**
 * Coverage tests for delegations/routes.ts (23.07% → target: 100%) and
 * delegations/repo.ts (3.07% → target: 100%).
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-aaa000000001";
const ACTOR_ID = "aaaaaaaa-2222-4000-8000-aaa000000001";

function makeToken(roles: string[] = ["workflow_user"], actorId = ACTOR_ID) {
  return signToken({ sub: actorId, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterEach(async () => {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.workflow_delegations WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/workflow/delegations", () => {
  it("creates a delegation and returns 201", async () => {
    const app = await buildApp();
    const delegateId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/delegations",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        delegateId,
        fromDate: "2025-01-01",
        toDate: "2025-12-31",
        reason: "on leave",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.delegateId).toBe(delegateId);
    expect(body.data.delegatorId).toBe(ACTOR_ID);
    expect(body.data.fromDate).toBe("2025-01-01");
    expect(body.data.toDate).toBe("2025-12-31");
    expect(body.data.isActive).toBe(true);
  });

  it("creates a delegation with no toDate (open-ended)", async () => {
    const app = await buildApp();
    const delegateId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/delegations",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        delegateId,
        fromDate: "2025-06-01",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.toDate).toBeNull();
  });

  it("returns 400 for invalid date format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/delegations",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        delegateId: randomUUID(),
        fromDate: "not-a-date",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/delegations",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: {
        delegateId: randomUUID(),
        fromDate: "2025-01-01",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/workflow/delegations", () => {
  it("returns empty list for a fresh tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/delegations",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    expect(res.json().total).toBe(0);
  });

  it("returns delegations with pagination", async () => {
    const app = await buildApp();
    // Create two delegations using the same app instance
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/workflow/delegations",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { delegateId: randomUUID(), fromDate: "2025-01-01" },
      });
    }
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/delegations?limit=10&offset=0",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBe(2);
    expect(res.json().total).toBe(2);
  });
});

describe("DELETE /v1/workflow/delegations/:id", () => {
  it("revokes a delegation and returns the updated record", async () => {
    const app = await buildApp();
    const delegateId = randomUUID();
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/delegations",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { delegateId, fromDate: "2025-01-01" },
    });
    expect(createRes.statusCode).toBe(201);
    const id = createRes.json().data.id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/delegations/${id}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().data.isActive).toBe(false);
  });

  it("returns 404 for non-existent delegation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/delegations/${randomUUID()}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});
