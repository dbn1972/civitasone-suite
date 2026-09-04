/**
 * complaints module — live end-to-end proof (real Postgres + real HTTP
 * routes + real consumers) of the full lifecycle and of the two bugs fixed
 * in this pass:
 *
 *   1. routes.ts previously hardcoded status literals that actively
 *      CONTRADICTED domain.ts's VALID_TRANSITIONS -- specifically, /close
 *      accepted "dispatched" directly, which the transition table does not
 *      allow (dispatched -> action_taken -> closed only), and no route ever
 *      produced "action_taken" at all, making it permanently unreachable.
 *      Routes now call canTransition() instead of hardcoding, and a new
 *      /action-taken route makes the state reachable.
 *   2. repo.ts's updateStatus previously had no fromStatus precondition in
 *      its WHERE clause (id + tenantId only), so a stale/racing write could
 *      silently apply instead of being rejected. It now takes an explicit
 *      allowedFromStatuses array (mirroring refund-service's requests/repo.ts,
 *      the fleet reference for this CAS pattern).
 *
 * See tests/complaints-cas.test.ts for a DB-level proof of the CAS guard
 * itself (bypassing the route pre-check) and tests/tenant-isolation.test.ts
 * for the RLS proof.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, ACTOR_A } from "./support.js";

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

async function createComplaint(): Promise<{ id: string; complaintNumber: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/animal/complaints",
    headers: hdr(ACTOR_A, TENANT_A, ["animal_user"]),
    payload: {
      location: { ward: "12", address: "Near market gate" },
      animalType: "dog",
      complaintType: "stray",
      severity: "high",
    },
  });
  expect(res.statusCode).toBe(202);
  const body = res.json() as { id: string; status: string };
  expect(body.status).toBe("accepted");
  await waitFor(async () => {
    const get = await app.inject({ method: "GET", url: `/v1/animal/complaints/${body.id}`, headers: hdr() });
    return get.statusCode === 200;
  });
  const get = await app.inject({ method: "GET", url: `/v1/animal/complaints/${body.id}`, headers: hdr() });
  return { id: body.id, complaintNumber: get.json().data.complaintNumber };
}

describe("complaints lifecycle — reported -> assigned -> dispatched -> action_taken -> closed", () => {
  it("walks the full happy path and every step persists correctly", async () => {
    const { id, complaintNumber } = await createComplaint();
    expect(complaintNumber).toMatch(/^ANML\/ULB\/\d{4}\/\d{6}$/);

    const initial = (await app.inject({ method: "GET", url: `/v1/animal/complaints/${id}`, headers: hdr() })).json().data;
    expect(initial.status).toBe("reported");
    expect(initial.version).toBe(1);

    // assign
    const officer = "d4444444-0000-4000-8000-000000000001";
    const assign = await app.inject({
      method: "POST",
      url: `/v1/animal/complaints/${id}/assign`,
      headers: hdr(),
      payload: { assignedTo: officer, assignedTeam: "field_team_north" },
    });
    expect(assign.statusCode).toBe(202);
    await drainQueue();
    const afterAssign = (await app.inject({ method: "GET", url: `/v1/animal/complaints/${id}`, headers: hdr() })).json().data;
    expect(afterAssign.status).toBe("assigned");
    expect(afterAssign.assignedTo).toBe(officer);
    expect(afterAssign.version).toBe(2);

    // dispatch
    const dispatch = await app.inject({ method: "POST", url: `/v1/animal/complaints/${id}/dispatch`, headers: hdr() });
    expect(dispatch.statusCode).toBe(202);
    await drainQueue();
    const afterDispatch = (await app.inject({ method: "GET", url: `/v1/animal/complaints/${id}`, headers: hdr() })).json().data;
    expect(afterDispatch.status).toBe("dispatched");

    // THE FIX, part 1: closing directly from "dispatched" is no longer
    // accepted -- pre-fix, routes.ts's /close hardcoded
    // `["dispatched", "action_taken"].includes(existing.status)`, directly
    // contradicting domain.ts's VALID_TRANSITIONS (dispatched only reaches
    // action_taken, never closed directly).
    const skipAhead = await app.inject({
      method: "POST",
      url: `/v1/animal/complaints/${id}/close`,
      headers: hdr(),
      payload: { resolution: "n/a" },
    });
    expect(skipAhead.statusCode).toBe(422);
    expect(skipAhead.json().code).toBe("INVALID_STATUS");
    // and the row did NOT change underneath the rejection.
    const stillDispatched = (await app.inject({ method: "GET", url: `/v1/animal/complaints/${id}`, headers: hdr() })).json().data;
    expect(stillDispatched.status).toBe("dispatched");

    // THE FIX, part 2: action_taken is now reachable via the new route.
    const actionTaken = await app.inject({ method: "POST", url: `/v1/animal/complaints/${id}/action-taken`, headers: hdr() });
    expect(actionTaken.statusCode).toBe(202);
    await drainQueue();
    const afterActionTaken = (await app.inject({ method: "GET", url: `/v1/animal/complaints/${id}`, headers: hdr() })).json().data;
    expect(afterActionTaken.status).toBe("action_taken");

    // close (now valid: action_taken -> closed)
    const close = await app.inject({
      method: "POST",
      url: `/v1/animal/complaints/${id}/close`,
      headers: hdr(),
      payload: { resolution: "Animal captured and relocated" },
    });
    expect(close.statusCode).toBe(202);
    await drainQueue();
    const afterClose = (await app.inject({ method: "GET", url: `/v1/animal/complaints/${id}`, headers: hdr() })).json().data;
    expect(afterClose.status).toBe("closed");
    expect(afterClose.resolution).toContain("relocated");

    // closed is terminal
    const reopen = await app.inject({
      method: "POST",
      url: `/v1/animal/complaints/${id}/action-taken`,
      headers: hdr(),
    });
    expect(reopen.statusCode).toBe(422);
  });

  it("rejects skipping straight to dispatch without assign first", async () => {
    const { id } = await createComplaint();
    const dispatch = await app.inject({ method: "POST", url: `/v1/animal/complaints/${id}/dispatch`, headers: hdr() });
    expect(dispatch.statusCode).toBe(422);
    expect(dispatch.json().code).toBe("INVALID_STATUS");
  });

  it("rejects action-taken on a complaint that was never dispatched", async () => {
    const { id } = await createComplaint();
    const res = await app.inject({ method: "POST", url: `/v1/animal/complaints/${id}/action-taken`, headers: hdr() });
    expect(res.statusCode).toBe(422);
  });

  it("404s on an unknown complaint id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/animal/complaints/00000000-0000-4000-8000-000000000000",
      headers: hdr(),
    });
    expect(res.statusCode).toBe(404);
  });
});
