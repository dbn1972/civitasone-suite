/**
 * operations module — live proof of the orphan-row fix: POST
 * /v1/animal/operations previously accepted any UUID-shaped complaintId
 * with no existence check, so an operation row could reference a complaint
 * that never existed (or belonged to a different tenant), with nothing at
 * the DB layer stopping it (animal_operations.complaint_id has no FK --
 * see migrations/0001_initial.sql). It now 404s pre-accept, mirroring every
 * other route in this service that resolves a path/body id against its
 * owning table first.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { registerOperationConsumers } from "../src/modules/operations/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerComplaintConsumers(queue);
  registerOperationConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function createComplaint(tenant = TENANT_A): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/animal/complaints",
    headers: hdr(ACTOR_A, tenant, ["animal_user"]),
    payload: { location: {}, animalType: "dog", complaintType: "stray", severity: "low" },
  });
  const body = res.json() as { id: string };
  await waitFor(async () => {
    const get = await app.inject({ method: "GET", url: `/v1/animal/complaints/${body.id}`, headers: hdr(ACTOR_A, tenant) });
    return get.statusCode === 200;
  });
  return body.id;
}

describe("POST /v1/animal/operations — orphan-row guard", () => {
  it("rejects a complaintId that does not exist, and does not publish/record the operation", async () => {
    const fakeComplaintId = "00000000-0000-4000-8000-000000000000";
    const res = await app.inject({
      method: "POST",
      url: "/v1/animal/operations",
      headers: hdr(),
      payload: {
        complaintId: fakeComplaintId,
        operationType: "capture",
        performedAt: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("COMPLAINT_NOT_FOUND");

    await drainQueue();
    const list = await app.inject({
      method: "GET",
      url: `/v1/animal/complaints/${fakeComplaintId}/operations`,
      headers: hdr(),
    });
    expect(list.json().data).toHaveLength(0);
  });

  it("rejects a complaintId that exists but belongs to a DIFFERENT tenant", async () => {
    const complaintId = await createComplaint(TENANT_B);
    const res = await app.inject({
      method: "POST",
      url: "/v1/animal/operations",
      headers: hdr(ACTOR_A, TENANT_A, ["animal_admin"]), // tenant A caller
      payload: {
        complaintId, // belongs to tenant B
        operationType: "capture",
        performedAt: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("accepts and persists an operation for a complaint that DOES exist in the caller's tenant", async () => {
    const complaintId = await createComplaint(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: "/v1/animal/operations",
      headers: hdr(),
      payload: {
        complaintId,
        operationType: "sterilize",
        performedAt: new Date().toISOString(),
        notes: "Routine sterilization",
      },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const list = await app.inject({
      method: "GET",
      url: `/v1/animal/complaints/${complaintId}/operations`,
      headers: hdr(),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json().data as Array<{ operationType: string; complaintId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.operationType).toBe("sterilize");
    expect(rows[0]!.complaintId).toBe(complaintId);
  });
});
