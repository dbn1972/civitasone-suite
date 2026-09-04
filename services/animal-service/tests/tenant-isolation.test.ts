/**
 * Cross-tenant RLS isolation — proves the FORCE ROW LEVEL SECURITY /
 * tenant_isolation policies added in migrations/0001_initial.sql actually
 * hold for every domain table in this service (animal_complaints,
 * animal_registrations, animal_operations all use the identical policy
 * shape). Mirrors services/swm-service/tests/tenant-isolation.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { registerRegistrationConsumers } from "../src/modules/registration/consumer.js";
import { registerOperationConsumers } from "../src/modules/operations/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerComplaintConsumers(queue);
  registerRegistrationConsumers(queue);
  registerOperationConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("tenant isolation — complaints", () => {
  it("tenant B cannot read tenant A's complaint by id, and list excludes it", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/animal/complaints",
      headers: hdr(ACTOR_A, TENANT_A, ["animal_user"]),
      payload: { location: {}, animalType: "dog", complaintType: "stray", severity: "low" },
    });
    expect(create.statusCode).toBe(202);
    const id = (create.json() as { id: string }).id;

    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/animal/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A) });
      return get.statusCode === 200;
    });

    const crossTenantGet = await app.inject({
      method: "GET",
      url: `/v1/animal/complaints/${id}`,
      headers: hdr(ACTOR_A, TENANT_B),
    });
    expect(crossTenantGet.statusCode).toBe(404);

    const crossTenantList = await app.inject({
      method: "GET",
      url: "/v1/animal/complaints",
      headers: hdr(ACTOR_A, TENANT_B),
    });
    expect(crossTenantList.statusCode).toBe(200);
    expect(crossTenantList.json().data.find((c: { id: string }) => c.id === id)).toBeUndefined();
  });

  it("tenant B cannot assign/dispatch/close tenant A's complaint (CAS + RLS both scope to caller's tenant)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/animal/complaints",
      headers: hdr(ACTOR_A, TENANT_A, ["animal_user"]),
      payload: { location: {}, animalType: "cat", complaintType: "injured", severity: "medium" },
    });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/animal/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A) });
      return get.statusCode === 200;
    });

    const crossTenantAssign = await app.inject({
      method: "POST",
      url: `/v1/animal/complaints/${id}/assign`,
      headers: hdr(ACTOR_A, TENANT_B, ["animal_admin"]),
      payload: { assignedTo: ACTOR_A, assignedTeam: "field_team" },
    });
    // findById scoped to TENANT_B sees nothing at this id -> 404, not 202/422.
    expect(crossTenantAssign.statusCode).toBe(404);

    const stillReported = (await app.inject({ method: "GET", url: `/v1/animal/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A) })).json().data;
    expect(stillReported.status).toBe("reported");
  });
});

describe("tenant isolation — registrations", () => {
  it("tenant B cannot read tenant A's registration by id, and list excludes it", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/animal/registrations",
      headers: hdr(ACTOR_A, TENANT_A, ["animal_user"]),
      payload: {
        ownerName: "Isolation Test Owner",
        ownerPhone: "9000000000",
        ownerAddress: { line1: "1 Test St", city: "Pune", pin: "411001" },
        animalType: "dog",
      },
    });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/animal/registrations/${id}`, headers: hdr(ACTOR_A, TENANT_A) });
      return get.statusCode === 200;
    });

    const crossTenantGet = await app.inject({ method: "GET", url: `/v1/animal/registrations/${id}`, headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossTenantGet.statusCode).toBe(404);

    const crossTenantList = await app.inject({ method: "GET", url: "/v1/animal/registrations", headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossTenantList.json().data.find((r: { id: string }) => r.id === id)).toBeUndefined();
  });
});

describe("tenant isolation — operations", () => {
  it("tenant B cannot list tenant A's complaint operations, and cannot record one against tenant A's complaint", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/animal/complaints",
      headers: hdr(ACTOR_A, TENANT_A, ["animal_user"]),
      payload: { location: {}, animalType: "dog", complaintType: "stray", severity: "low" },
    });
    const complaintId = (create.json() as { id: string }).id;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/animal/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A) });
      return get.statusCode === 200;
    });

    // Orphan-row guard (fixed in this pass) doubles as a tenant boundary
    // here: complaintsRepo.findById is itself tenant-scoped, so a
    // cross-tenant complaintId resolves to "not found" for tenant B.
    const recordAsB = await app.inject({
      method: "POST",
      url: "/v1/animal/operations",
      headers: hdr(ACTOR_A, TENANT_B, ["animal_admin"]),
      payload: { complaintId, operationType: "capture", performedAt: new Date().toISOString() },
    });
    expect(recordAsB.statusCode).toBe(404);

    const listAsB = await app.inject({
      method: "GET",
      url: `/v1/animal/complaints/${complaintId}/operations`,
      headers: hdr(ACTOR_A, TENANT_B, ["animal_admin"]),
    });
    expect(listAsB.statusCode).toBe(200);
    expect(listAsB.json().data).toHaveLength(0);
  });
});
