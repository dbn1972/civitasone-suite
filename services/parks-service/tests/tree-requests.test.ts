/**
 * tree_requests module — real DB-backed route -> consumer -> persisted-state
 * coverage, plus regression coverage for the request_number collision bug
 * (see complaints.test.ts's header for the full shared rationale — same
 * bug shape, same fix: migrations/0002_number_sequences.sql).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerTreeRequestConsumers } from "../src/modules/tree_requests/consumer.js";
import * as repo from "../src/modules/tree_requests/repo.js";
import { authHeader, ADMIN_ROLES, USER_ROLES, drainQueue } from "./_helpers.js";

const TENANT = "d0000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "d0000000-0000-4000-8000-000000000002";
const ACTOR = "d0000000-0000-4000-8000-0000000000aa";

let app: FastifyInstance;

beforeAll(async () => {
  registerTreeRequestConsumers(queue);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/parks/tree-requests — route -> consumer -> persisted state", () => {
  it("creates a tree request: 202, then a real row with a sequence-backed request_number", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/parks/tree-requests",
      headers: { ...authHeader(TENANT, ACTOR, USER_ROLES), "content-type": "application/json" },
      payload: { requestType: "pruning", treeSpecies: "Neem", reason: "Overhanging power lines" },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json();

    await drainQueue(queue);

    const row = await repo.findById(id, TENANT);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("submitted");
    expect(row!.requestNumber).toMatch(/^PRKT-\d+$/);
  });

  it("full lifecycle: inspect -> approve -> complete", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/tree-requests",
      headers: { ...authHeader(TENANT, ACTOR, USER_ROLES), "content-type": "application/json" },
      payload: { requestType: "removal" },
    });
    const { id } = createRes.json();
    await drainQueue(queue);

    const inspectRes = await app.inject({
      method: "POST",
      url: `/v1/parks/tree-requests/${id}/inspect`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { inspectionReport: { condition: "diseased" }, version: 1 },
    });
    expect(inspectRes.statusCode).toBe(202);
    await drainQueue(queue);
    expect((await repo.findById(id, TENANT))!.status).toBe("inspected");

    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/parks/tree-requests/${id}/approve`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { version: 2 },
    });
    expect(approveRes.statusCode).toBe(202);
    await drainQueue(queue);
    expect((await repo.findById(id, TENANT))!.status).toBe("approved");

    const completeRes = await app.inject({
      method: "POST",
      url: `/v1/parks/tree-requests/${id}/complete`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { version: 3 },
    });
    expect(completeRes.statusCode).toBe(202);
    await drainQueue(queue);
    expect((await repo.findById(id, TENANT))!.status).toBe("completed");
  });

  it("rejects an invalid transition (approve before inspect) with 422", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/tree-requests",
      headers: { ...authHeader(TENANT, ACTOR, USER_ROLES), "content-type": "application/json" },
      payload: { requestType: "new_planting" },
    });
    const { id } = createRes.json();
    await drainQueue(queue);

    const res = await app.inject({
      method: "POST",
      url: `/v1/parks/tree-requests/${id}/approve`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("request_number — tenant-scoped UNIQUE constraint", () => {
  async function insertWithNumber(tenantId: string, requestNumber: string) {
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${tenantId}'`));
      await repo.insert(tx, {
        id, tenantId, requestNumber, requestedBy: ACTOR, requestType: "pruning",
        location: null, treeSpecies: null, reason: null, photos: null, status: "submitted",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    });
    return id;
  }

  it("rejects a second row for the SAME tenant with a duplicate request_number", async () => {
    const dupNumber = `DUP-${randomUUID().slice(0, 8)}`;
    await insertWithNumber(TENANT, dupNumber);
    await expect(insertWithNumber(TENANT, dupNumber)).rejects.toThrow();
  });

  it("allows the SAME request_number for two DIFFERENT tenants", async () => {
    const sharedNumber = `SHARED-${randomUUID().slice(0, 8)}`;
    await expect(insertWithNumber(TENANT, sharedNumber)).resolves.toBeDefined();
    await expect(insertWithNumber(OTHER_TENANT, sharedNumber)).resolves.toBeDefined();
  });
});
