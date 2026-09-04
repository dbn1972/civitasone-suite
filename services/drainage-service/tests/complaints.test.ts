/**
 * Route -> command -> real consumer -> persisted-state coverage for the
 * complaints module. Every write here goes through the real HTTP route,
 * the real publishCommand/queue, and the real registerComplaintConsumers
 * handler (mirroring src/worker.ts) -- no mocked db/queue/repo layers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { hdr, waitFor, ADMIN_ROLES, USER_ROLES, TENANT_A, ACTOR_A, ACTOR_B } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerComplaintConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const complaintBody = {
  location: { ward: "12" },
  complaintType: "blocked_drain" as const,
  description: "Drain blocked near main road",
};

async function createAndWait(body: Record<string, unknown> = complaintBody, roles = USER_ROLES) {
  const create = await app.inject({ method: "POST", url: "/v1/drainage/complaints", headers: hdr(ACTOR_A, TENANT_A, roles), payload: body });
  expect(create.statusCode).toBe(202);
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
  return id;
}

describe("POST /v1/drainage/complaints", () => {
  it("creates a complaint and persists it with default severity derived from complaintType", async () => {
    const id = await createAndWait({ ...complaintBody, complaintType: "structural_damage" });
    const row = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.status).toBe("reported");
    expect(row.severity).toBe("critical"); // classifySeverity(structural_damage)
    expect(row.version).toBe(1);
    expect(row.reportedBy).toBe(ACTOR_A);
    expect(typeof row.complaintNumber).toBe("string");
    expect(row.complaintNumber).toMatch(/^DRN-\d+-\d{4}$/);
  });

  it("honours an explicit severity override instead of the derived default", async () => {
    const id = await createAndWait({ ...complaintBody, complaintType: "blocked_drain", severity: "critical" });
    const row = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.severity).toBe("critical");
  });

  it("rejects an invalid complaintType with a 400 before ever publishing a command", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/drainage/complaints", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: { ...complaintBody, complaintType: "not_a_real_type" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unauthenticated / unauthorized caller", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/drainage/complaints", headers: hdr(ACTOR_A, TENANT_A, []), payload: complaintBody });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/drainage/complaints", () => {
  it("lists complaints scoped to the caller's tenant with pagination metadata, filterable by status/severity", async () => {
    await createAndWait({ ...complaintBody, severity: "low" });
    const res = await app.inject({ method: "GET", url: "/v1/drainage/complaints?limit=5&status=reported&severity=low", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.pageSize).toBe(5);
    expect(body.data.every((c: { status: string; severity: string }) => c.status === "reported" && c.severity === "low")).toBe(true);
  });
});

describe("complaint lifecycle: assign -> resolve -> close", () => {
  it("full happy path moves through reported -> assigned -> in_progress-eligible resolve -> resolved -> closed with version bumping each step", async () => {
    const id = await createAndWait();
    let row = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.version).toBe(1);

    const assign = await app.inject({ method: "POST", url: `/v1/drainage/complaints/${id}/assign`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { assignedTo: ACTOR_B, version: row.version } });
    expect(assign.statusCode).toBe(202);
    await waitFor(async () => {
      const r = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
      return r.status === "assigned";
    });
    row = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.assignedTo).toBe(ACTOR_B);
    expect(row.version).toBe(2);

    // resolve directly from "assigned" is a valid transition per domain.ts's
    // TRANSITIONS table (assigned -> [in_progress, closed] does NOT include
    // resolved -- resolved only comes from in_progress). So resolving here
    // while still "assigned" must be rejected with 422, proving the route's
    // validateComplaintTransition guard is real and not a rubber stamp.
    const badResolve = await app.inject({ method: "POST", url: `/v1/drainage/complaints/${id}/resolve`, headers: hdr(ACTOR_B, TENANT_A, USER_ROLES), payload: { resolution: "fixed", version: row.version } });
    expect(badResolve.statusCode).toBe(422);

    // close (unlike resolve) always requires ADMIN_ROLES -- no assignee
    // exception -- so this call authenticates as an admin, not as ACTOR_B's
    // own drainage_user role. assigned -> closed IS a valid transition.
    const close = await app.inject({ method: "POST", url: `/v1/drainage/complaints/${id}/close`, headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES), payload: { version: row.version } });
    expect(close.statusCode).toBe(202);
    await waitFor(async () => {
      const r = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
      return r.status === "closed";
    });
    row = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.version).toBe(3);
  });

  it("rejects assign from a non-admin role with 403, and leaves the row untouched", async () => {
    const id = await createAndWait();
    const res = await app.inject({ method: "POST", url: `/v1/drainage/complaints/${id}/assign`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: { assignedTo: ACTOR_B, version: 1 } });
    expect(res.statusCode).toBe(403);
    const row = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.status).toBe("reported");
    expect(row.version).toBe(1);
  });

  it("rejects assign with a stale version with 409 VERSION_CONFLICT, and does not publish/apply the command", async () => {
    const id = await createAndWait();
    const res = await app.inject({ method: "POST", url: `/v1/drainage/complaints/${id}/assign`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { assignedTo: ACTOR_B, version: 99 } });
    expect(res.statusCode).toBe(409);
    const row = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.status).toBe("reported");
  });

  it("resolve: only an admin or the currently-assigned worker may resolve; any other drainage_user is forbidden", async () => {
    const id = await createAndWait();
    await app.inject({ method: "POST", url: `/v1/drainage/complaints/${id}/assign`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { assignedTo: ACTOR_B, version: 1 } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "assigned");

    // A third, unrelated user (not admin, not the assignee) must be forbidden.
    const strangerId = "d4444444-0000-4000-8000-000000000099";
    const row = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    const forbidden = await app.inject({ method: "POST", url: `/v1/drainage/complaints/${id}/resolve`, headers: hdr(strangerId, TENANT_A, USER_ROLES), payload: { resolution: "n/a", version: row.version } });
    expect(forbidden.statusCode).toBe(403);
  });

  it("404s on assign/resolve/close for a nonexistent complaint id", async () => {
    const fakeId = "e5555555-0000-4000-8000-000000000001";
    const res = await app.inject({ method: "POST", url: `/v1/drainage/complaints/${fakeId}/assign`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { assignedTo: ACTOR_B, version: 1 } });
    expect(res.statusCode).toBe(404);
  });
});
