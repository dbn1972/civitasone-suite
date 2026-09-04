/**
 * Route -> command -> real consumer -> persisted-state coverage for the
 * field_actions module, plus the cross-module side effect it owns: logging
 * a field action against an "assigned" complaint is what actually moves
 * that complaint to "in_progress" (see field_actions/domain.ts's header
 * comment -- this closes a previously-unreachable transition, fixed in
 * PR #830). Also covers the pre-accept validation at both the route layer
 * (fast 404/422 before a command is even published) and the consumer layer
 * (the defensive backstop for a complaint that changed status between the
 * HTTP read and message processing).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { registerFieldActionConsumers } from "../src/modules/field_actions/consumer.js";
import { hdr, waitFor, drainQueue, ADMIN_ROLES, USER_ROLES, TENANT_A, ACTOR_A, ACTOR_B } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerComplaintConsumers(queue);
  registerFieldActionConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const complaintBody = {
  location: { ward: "7" },
  complaintType: "waterlogging" as const,
  description: "Waterlogging near junction",
};

async function createComplaint(): Promise<string> {
  const create = await app.inject({ method: "POST", url: "/v1/drainage/complaints", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: complaintBody });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
  return id;
}

async function createAndAssignComplaint(): Promise<string> {
  const id = await createComplaint();
  await app.inject({ method: "POST", url: `/v1/drainage/complaints/${id}/assign`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { assignedTo: ACTOR_B, version: 1 } });
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "assigned");
  return id;
}

describe("POST /v1/drainage/field-actions", () => {
  it("404s pre-accept when the referenced complaint does not exist -- never publishes a command", async () => {
    const fakeId = "f6666666-0000-4000-8000-000000000001";
    const res = await app.inject({
      method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES),
      payload: { complaintId: fakeId, actionType: "cleaning", notes: "n/a" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("422s pre-accept when the complaint is not in an eligible status (e.g. still 'reported', never assigned)", async () => {
    const id = await createComplaint();
    const res = await app.inject({
      method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES),
      payload: { complaintId: id, actionType: "cleaning", notes: "n/a" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("requires ADMIN_ROLES to log a field action (drainage_user alone is forbidden)", async () => {
    const id = await createAndAssignComplaint();
    const res = await app.inject({
      method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_A, USER_ROLES),
      payload: { complaintId: id, actionType: "cleaning", notes: "n/a" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates a field action against an assigned complaint, persists it with the real id from the consumer INSERT, and auto-transitions the complaint to in_progress", async () => {
    const complaintId = await createAndAssignComplaint();
    const create = await app.inject({
      method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES),
      payload: { complaintId, actionType: "desilting", notes: "Cleared silt buildup", durationMinutes: 45 },
    });
    expect(create.statusCode).toBe(202);
    const fieldActionId = (create.json() as { id: string }).id;

    // Proves the consumer's INSERT actually carried the command's own `id`
    // (a previously-seen bug class is a consumer that lets the DB default
    // generate a fresh id, silently orphaning the id returned by the route).
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/field-actions/${fieldActionId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
    const row = (await app.inject({ method: "GET", url: `/v1/drainage/field-actions/${fieldActionId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.id).toBe(fieldActionId);
    expect(row.complaintId).toBe(complaintId);
    expect(row.performedBy).toBe(ACTOR_B);
    expect(row.durationMinutes).toBe(45);

    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "in_progress");
    const complaint = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(complaint.status).toBe("in_progress");
    expect(complaint.version).toBe(3); // 1 (created) -> 2 (assigned) -> 3 (auto in_progress)
  });

  it("logging a second field action once already in_progress does not error and does not re-bump the complaint's status/version via a stray CAS attempt", async () => {
    const complaintId = await createAndAssignComplaint();
    await app.inject({ method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES), payload: { complaintId, actionType: "cleaning", notes: "first" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "in_progress");
    const afterFirst = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;

    const second = await app.inject({ method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES), payload: { complaintId, actionType: "repair", notes: "second" } });
    expect(second.statusCode).toBe(202);
    await drainQueue();
    await new Promise((r) => setTimeout(r, 150));
    await drainQueue();

    const listRes = await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}/field-actions`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    expect(listRes.json().data.length).toBe(2);

    const afterSecond = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(afterSecond.status).toBe("in_progress");
    expect(afterSecond.version).toBe(afterFirst.version); // no further CAS write attempted once already in_progress
  });

  it("422s pre-accept for a field action against an already-resolved complaint", async () => {
    const complaintId = await createAndAssignComplaint();
    await app.inject({ method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES), payload: { complaintId, actionType: "cleaning", notes: "x" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "in_progress");
    const row = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    await app.inject({ method: "POST", url: `/v1/drainage/complaints/${complaintId}/resolve`, headers: hdr(ACTOR_B, TENANT_A, USER_ROLES), payload: { resolution: "done", version: row.version } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "resolved");

    const res = await app.inject({ method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES), payload: { complaintId, actionType: "cleaning", notes: "too late" } });
    expect(res.statusCode).toBe(422);
  });
});

describe("GET /v1/drainage/field-actions and /v1/drainage/complaints/:id/field-actions", () => {
  it("lists field actions scoped to the tenant, and by complaint", async () => {
    const complaintId = await createAndAssignComplaint();
    await app.inject({ method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES), payload: { complaintId, actionType: "replacement", notes: "x" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}/field-actions`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.length === 1);
    const byComplaint = await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}/field-actions`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    expect(byComplaint.json().data).toHaveLength(1);
    expect(byComplaint.json().data[0].complaintId).toBe(complaintId);
  });
});
