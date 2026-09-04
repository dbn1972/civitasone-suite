/**
 * inspections module — regression coverage for the orphan-row / validation
 * gap this hardening pass closes:
 *
 *   createBody previously accepted complaintId/treeRequestId as both
 *   `.uuid().optional()`, with (a) no refinement requiring at least one of
 *   them, and (b) no existence check on whichever was supplied. `POST
 *   /v1/parks/inspections` with body `{}` returned 202 and the consumer
 *   inserted a parks_inspections row with BOTH columns NULL — an inspection
 *   referencing nothing. A fabricated complaintId/treeRequestId had the same
 *   problem: 202, then a row referencing a complaint/tree request that does
 *   not exist.
 *
 * Fixed in routes.ts (Zod `.refine` + a tenant-scoped existence check before
 * the command is even published) and, as defense-in-depth, in consumer.ts
 * (the same existence check re-run inside the transaction, in case a
 * command ever reaches the queue by a path other than this route — e.g. a
 * direct publish, exercised explicitly below).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { registerTreeRequestConsumers } from "../src/modules/tree_requests/consumer.js";
import { registerInspectionConsumers } from "../src/modules/inspections/consumer.js";
import * as inspectionsRepo from "../src/modules/inspections/repo.js";
import * as complaintsRepo from "../src/modules/complaints/repo.js";
import * as treeRequestsRepo from "../src/modules/tree_requests/repo.js";
import { COMMANDS } from "../src/topics.js";
import { authHeader, ADMIN_ROLES, drainQueue } from "./_helpers.js";

const TENANT = "f0000000-0000-4000-8000-000000000001";
const ACTOR = "f0000000-0000-4000-8000-0000000000aa";

let app: FastifyInstance;

async function createRealComplaint(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/parks/complaints",
    headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
    payload: { complaintType: "overgrown" },
  });
  const { id } = res.json();
  await drainQueue(queue);
  return id;
}

async function createRealTreeRequest(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/parks/tree-requests",
    headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
    payload: { requestType: "pruning" },
  });
  const { id } = res.json();
  await drainQueue(queue);
  return id;
}

beforeAll(async () => {
  registerComplaintConsumers(queue);
  registerTreeRequestConsumers(queue);
  registerInspectionConsumers(queue);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/parks/inspections — orphan-row fix", () => {
  it("rejects an empty body: neither complaintId nor treeRequestId supplied (400, never reaches the queue)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/parks/inspections",
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a body with only scheduledDate (still neither reference supplied)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/parks/inspections",
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { scheduledDate: "2026-09-10" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a fabricated (well-formed but nonexistent) complaintId with 404, and does not enqueue a command", async () => {
    const fakeId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/parks/inspections",
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { complaintId: fakeId },
    });
    expect(res.statusCode).toBe(404);
    // Since the route rejects before publishing, there is nothing to drain
    // and nothing that could have been inserted — belt-and-braces check:
    await drainQueue(queue);
    const rows = await inspectionsRepo.listByTenant(TENANT, 200, 0);
    expect(rows.rows.some((r) => r.complaintId === fakeId)).toBe(false);
  });

  it("rejects a fabricated (well-formed but nonexistent) treeRequestId with 404", async () => {
    const fakeId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/parks/inspections",
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { treeRequestId: fakeId },
    });
    expect(res.statusCode).toBe(404);
  });

  it("accepts a real complaintId: 202, then a real row referencing it", async () => {
    const complaintId = await createRealComplaint();
    const res = await app.inject({
      method: "POST",
      url: "/v1/parks/inspections",
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { complaintId },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json();
    await drainQueue(queue);

    const row = await inspectionsRepo.findById(id, TENANT);
    expect(row).not.toBeNull();
    expect(row!.complaintId).toBe(complaintId);
    expect(row!.treeRequestId).toBeNull();
    expect(row!.status).toBe("scheduled");
  });

  it("accepts a real treeRequestId: 202, then a real row referencing it", async () => {
    const treeRequestId = await createRealTreeRequest();
    const res = await app.inject({
      method: "POST",
      url: "/v1/parks/inspections",
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { treeRequestId },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json();
    await drainQueue(queue);

    const row = await inspectionsRepo.findById(id, TENANT);
    expect(row).not.toBeNull();
    expect(row!.treeRequestId).toBe(treeRequestId);
  });

  it("complete transitions a scheduled inspection through TRANSITION_INVALID / VERSION_CONFLICT / happy path correctly", async () => {
    const complaintId = await createRealComplaint();
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/inspections",
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { complaintId },
    });
    const { id } = createRes.json();
    await drainQueue(queue);

    const staleVersion = await app.inject({
      method: "POST",
      url: `/v1/parks/inspections/${id}/complete`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { findings: { status: "ok" }, workOrderRequired: false, version: 99 },
    });
    expect(staleVersion.statusCode).toBe(409);

    const completeRes = await app.inject({
      method: "POST",
      url: `/v1/parks/inspections/${id}/complete`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { findings: { status: "ok" }, workOrderRequired: true, version: 1 },
    });
    expect(completeRes.statusCode).toBe(202);
    await drainQueue(queue);
    const completed = await inspectionsRepo.findById(id, TENANT);
    expect(completed!.status).toBe("completed");
    expect(completed!.workOrderRequired).toBe(true);

    // Already completed — completing again must fail (TRANSITION_INVALID),
    // not silently re-apply.
    const again = await app.inject({
      method: "POST",
      url: `/v1/parks/inspections/${id}/complete`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { findings: {}, workOrderRequired: false, version: 2 },
    });
    expect(again.statusCode).toBe(422);
  });
});

describe("SCHEDULE_INSPECTION consumer — defense-in-depth existence check", () => {
  // Bypasses the route entirely (a directly-published or replayed command
  // is exactly the scenario the route-level check CANNOT protect against),
  // to prove the consumer itself refuses to write an orphan row rather than
  // trusting its own queue payload.
  it("does not insert a row when the published command references a nonexistent complaintId", async () => {
    const id = randomUUID();
    const fakeComplaintId = randomUUID();
    await queue.publish(COMMANDS.SCHEDULE_INSPECTION, {
      type: COMMANDS.SCHEDULE_INSPECTION,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { id, complaintId: fakeComplaintId, treeRequestId: null, inspectorId: ACTOR, scheduledDate: null },
    });
    await drainQueue(queue);

    const row = await inspectionsRepo.findById(id, TENANT);
    expect(row).toBeNull();
  });

  it("does not insert a row when the published command has neither complaintId nor treeRequestId", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.SCHEDULE_INSPECTION, {
      type: COMMANDS.SCHEDULE_INSPECTION,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { id, complaintId: null, treeRequestId: null, inspectorId: ACTOR, scheduledDate: null },
    });
    await drainQueue(queue);

    const row = await inspectionsRepo.findById(id, TENANT);
    expect(row).toBeNull();
  });

  it("DOES insert a row when the published command references a real complaintId (control case — proves the guard above isn't just rejecting everything)", async () => {
    const complaintId = await createRealComplaint();
    const id = randomUUID();
    await queue.publish(COMMANDS.SCHEDULE_INSPECTION, {
      type: COMMANDS.SCHEDULE_INSPECTION,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { id, complaintId, treeRequestId: null, inspectorId: ACTOR, scheduledDate: null },
    });
    await drainQueue(queue);

    const row = await inspectionsRepo.findById(id, TENANT);
    expect(row).not.toBeNull();
    expect(row!.complaintId).toBe(complaintId);
  });
});
