/**
 * complaints module — real DB-backed route -> consumer -> persisted-state
 * coverage, plus regression coverage for the two bugs fixed alongside this
 * suite:
 *   - complaint_number was a bare `PRK-${Date.now()}` computed in the route's
 *     command handler (commands.ts), with no UNIQUE constraint — two
 *     requests in the same millisecond silently duplicated. Fixed by
 *     migrations/0002_number_sequences.sql (tenant-scoped UNIQUE + a real
 *     Postgres SEQUENCE) and the paired repo.nextComplaintNumber/
 *     domain.formatComplaintNumber change.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import * as repo from "../src/modules/complaints/repo.js";
import { authHeader, ADMIN_ROLES, USER_ROLES, drainQueue } from "./_helpers.js";

const TENANT = "c0000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "c0000000-0000-4000-8000-000000000002";
const ACTOR = "c0000000-0000-4000-8000-0000000000aa";

let app: FastifyInstance;

beforeAll(async () => {
  registerComplaintConsumers(queue);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/parks/complaints — route -> consumer -> persisted state", () => {
  it("rejects an unknown complaintType (validation happens before publish)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/parks/complaints",
      headers: { ...authHeader(TENANT, ACTOR, USER_ROLES), "content-type": "application/json" },
      payload: { complaintType: "not_a_real_type" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires a role (401 with no token)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/parks/complaints", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("creates a complaint: 202 from the route, then a real row with a sequence-backed number after the consumer runs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/parks/complaints",
      headers: { ...authHeader(TENANT, ACTOR, USER_ROLES), "content-type": "application/json" },
      payload: { complaintType: "broken_equipment", description: "Bench broken in sector 4", severity: "medium" },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json();
    expect(id).toBeDefined();

    await drainQueue(queue);

    const row = await repo.findById(id, TENANT);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("reported");
    expect(row!.complaintType).toBe("broken_equipment");
    // Sequence-backed format (PRK-<n>), NOT the old Date.now()-based
    // PRK-<13-digit-epoch-ms> — a real regression guard: if commands.ts
    // ever again computed complaintNumber synchronously instead of via
    // repo.nextComplaintNumber, this would still match (Date.now() output
    // is also all-digits), so the collision test below is the one that
    // actually proves the fix; this test proves the happy path still works.
    expect(row!.complaintNumber).toMatch(/^PRK-\d+$/);
  });

  it("full lifecycle: assign -> resolve -> close, each transition persisted", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/complaints",
      headers: { ...authHeader(TENANT, ACTOR, USER_ROLES), "content-type": "application/json" },
      payload: { complaintType: "vandalism" },
    });
    const { id } = createRes.json();
    await drainQueue(queue);
    const created = await repo.findById(id, TENANT);
    expect(created!.version).toBe(1);

    const assignRes = await app.inject({
      method: "POST",
      url: `/v1/parks/complaints/${id}/assign`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { assignedTo: ACTOR, version: 1 },
    });
    expect(assignRes.statusCode).toBe(202);
    await drainQueue(queue);
    const assigned = await repo.findById(id, TENANT);
    expect(assigned!.status).toBe("assigned");
    expect(assigned!.assignedTo).toBe(ACTOR);
    expect(assigned!.version).toBe(2);

    const resolveRes = await app.inject({
      method: "POST",
      url: `/v1/parks/complaints/${id}/resolve`,
      headers: { ...authHeader(TENANT, ACTOR, USER_ROLES), "content-type": "application/json" },
      payload: { resolution: "Bench repaired", version: 2 },
    });
    expect(resolveRes.statusCode).toBe(202);
    await drainQueue(queue);
    const resolved = await repo.findById(id, TENANT);
    expect(resolved!.status).toBe("resolved");
    expect(resolved!.version).toBe(3);

    const closeRes = await app.inject({
      method: "POST",
      url: `/v1/parks/complaints/${id}/close`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { version: 3 },
    });
    expect(closeRes.statusCode).toBe(202);
    await drainQueue(queue);
    const closed = await repo.findById(id, TENANT);
    expect(closed!.status).toBe("closed");
  });

  it("rejects an invalid transition (close before assign) with 422, and a stale version with 409", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/complaints",
      headers: { ...authHeader(TENANT, ACTOR, USER_ROLES), "content-type": "application/json" },
      payload: { complaintType: "pest" },
    });
    const { id } = createRes.json();
    await drainQueue(queue);

    const badTransition = await app.inject({
      method: "POST",
      url: `/v1/parks/complaints/${id}/close`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { version: 1 },
    });
    expect(badTransition.statusCode).toBe(422);

    const staleVersion = await app.inject({
      method: "POST",
      url: `/v1/parks/complaints/${id}/assign`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { assignedTo: ACTOR, version: 99 },
    });
    expect(staleVersion.statusCode).toBe(409);
  });
});

describe("complaint_number — tenant-scoped UNIQUE constraint (migrations/0002_number_sequences.sql)", () => {
  async function insertWithNumber(tenantId: string, complaintNumber: string) {
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${tenantId}'`));
      await repo.insert(tx, {
        id, tenantId, complaintNumber, reportedBy: ACTOR,
        location: null, parkAssetRef: null, complaintType: "overgrown",
        description: null, photo: null, severity: null, status: "reported",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    });
    return id;
  }

  it("rejects a second row for the SAME tenant with a duplicate complaint_number", async () => {
    const dupNumber = `DUP-${randomUUID().slice(0, 8)}`;
    await insertWithNumber(TENANT, dupNumber);
    await expect(insertWithNumber(TENANT, dupNumber)).rejects.toThrow();
  });

  it("allows the SAME complaint_number for two DIFFERENT tenants (constraint is tenant-scoped, not global)", async () => {
    const sharedNumber = `SHARED-${randomUUID().slice(0, 8)}`;
    await expect(insertWithNumber(TENANT, sharedNumber)).resolves.toBeDefined();
    await expect(insertWithNumber(OTHER_TENANT, sharedNumber)).resolves.toBeDefined();
  });
});
