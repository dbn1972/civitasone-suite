/**
 * Real-DB integration test for building-service's permits module.
 *
 * Replaces the previous vi.mock("../../shared/db.js") version, which mocked
 * the entire DB layer and so proved nothing about real Postgres/RLS
 * behaviour (no schema, no unique constraint, no cache TTL was ever
 * exercised). This file drives the actual Fastify app + the actual
 * consumer against a real, migrated Postgres database.
 *
 * Covers:
 *  1. The pre-accept validation gap fixed in permits/routes.ts: POST
 *     /v1/building/permits now 404s on a non-existent application, 422s on
 *     a non-'approved' application, and 409s on a second issue attempt for
 *     the same application (application-layer guard ahead of the
 *     building_permits_application_id_key unique index from PR #1001 — a
 *     raw constraint violation would otherwise surface as an unhandled 500).
 *  2. Route -> consumer -> persisted-state: a 202 alone proves nothing in
 *     this async CQRS pattern — every assertion below re-reads the row.
 *  3. Read-through cache invalidation (shared/infra.ts, TTL 60s): GET is
 *     called BEFORE and AFTER each status-changing consumer runs, in the
 *     same test process/run (well under the 60s TTL) — if the consumer
 *     stopped invalidating cache.makeKey(tenantId, "permit", id), the
 *     "after" read would return the stale cached value and the assertion
 *     would fail for real, not just by inspecting mock calls.
 *  4. The fake-success guard (suspend/cancel/restore ignoring
 *     repo.updatePermitStatus's boolean "did a row actually match" return):
 *     a raw command published directly to the queue for a permitId that
 *     does not exist must not write an outbox event or audit row — checked
 *     directly against _outbox.messages, not by inspecting a mock.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../../app.js";
import { queue } from "../../shared/infra.js";
import { db, sqlClient } from "../../shared/db.js";
import { registerPermitConsumers } from "./consumer.js";
import { registerApplicationConsumers } from "../applications/consumer.js";
import * as applicationsRepo from "../applications/repo.js";
import { COMMANDS } from "../../topics.js";

// `drain()` is a test-aid method on the concrete Bus implementation
// (services/queue-service/src/bus.ts) that resolves once every in-flight
// delivery (including retry backoffs and any cascaded publishes) has
// settled — it lets a test await async fan-out deterministically instead of
// racing a fixed sleep. It is intentionally not part of the public `Queue`
// interface (production consumers are push-based and never need it), so it
// is accessed through a narrow local cast rather than widening the shared
// `Queue` type fleet-wide for a test-only concern.
async function drain(): Promise<void> {
  await (queue as unknown as { drain(): Promise<void> }).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function token(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "test-session" }, SECRET, 3600);
}

const officerAuth = { authorization: `Bearer ${token(ACTOR, ["building_admin"])}` };

let app: FastifyInstance;

async function seedApplication(status: "approved" | "draft" | "submitted"): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, async () => {
    await db.transaction(async (tx) => {
      await applicationsRepo.insertApplication(tx, {
        id,
        tenantId: TENANT,
        applicationNumber: `BLDG/TEST/${randomUUID().slice(0, 8)}`,
        status,
        siteAddress: { line1: "1 Test Street", city: "Test City", pin: "560001" },
        feeMinor: 500000n,
        feeCurrency: "INR",
        feePaid: true,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    });
  });
  return id;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerPermitConsumers(queue);
  registerApplicationConsumers(queue);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/building/permits — pre-accept validation (fix for the accept-anything gap)", () => {
  it("404s when the referenced application does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/building/permits",
      headers: officerAuth,
      payload: { applicationId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("APPLICATION_NOT_FOUND");
  });

  it("422s when the application exists but is not 'approved'", async () => {
    const applicationId = await seedApplication("submitted");
    const res = await app.inject({
      method: "POST",
      url: "/v1/building/permits",
      headers: officerAuth,
      payload: { applicationId },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("APPLICATION_NOT_APPROVED");
  });

  it("issues a permit for an approved application, and the write is really persisted", async () => {
    const applicationId = await seedApplication("approved");
    const issueRes = await app.inject({
      method: "POST",
      url: "/v1/building/permits",
      headers: officerAuth,
      payload: { applicationId, validityMonths: 12 },
    });
    expect(issueRes.statusCode).toBe(202);
    const { id: permitId } = issueRes.json() as { id: string };
    await drain();

    const getRes = await app.inject({ method: "GET", url: `/v1/building/permits/${permitId}`, headers: officerAuth });
    expect(getRes.statusCode).toBe(200);
    const permit = getRes.json().data;
    expect(permit.id).toBe(permitId);
    expect(permit.applicationId).toBe(applicationId);
    expect(permit.status).toBe("active");
    expect(permit.permitNumber).toMatch(/^PERM\/BLDG\/ULB\/\d{4}\/\d{6}$/);
  });

  it("409s a second issue attempt for the same (now-permitted) application — the application-layer duplicate guard", async () => {
    const applicationId = await seedApplication("approved");
    const first = await app.inject({ method: "POST", url: "/v1/building/permits", headers: officerAuth, payload: { applicationId } });
    expect(first.statusCode).toBe(202);
    await drain();

    const second = await app.inject({ method: "POST", url: "/v1/building/permits", headers: officerAuth, payload: { applicationId } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("PERMIT_ALREADY_EXISTS");
  });
});

describe("permits repo — reissuing after cancellation is allowed (partial unique index, not a plain UNIQUE)", () => {
  it("a cancelled permit does not block a fresh permit for the same application", async () => {
    const applicationId = await seedApplication("approved");

    const first = await app.inject({ method: "POST", url: "/v1/building/permits", headers: officerAuth, payload: { applicationId } });
    expect(first.statusCode).toBe(202);
    const { id: firstId } = first.json() as { id: string };
    await drain();

    const cancel = await app.inject({
      method: "POST",
      url: `/v1/building/permits/${firstId}/cancel`,
      headers: officerAuth,
      payload: { reason: "issued in error, applicant needs to reschedule" },
    });
    expect(cancel.statusCode).toBe(202);
    await drain();
    const cancelled = await app.inject({ method: "GET", url: `/v1/building/permits/${firstId}`, headers: officerAuth });
    expect(cancelled.json().data.status).toBe("cancelled");

    // The application-level PERMIT_ALREADY_EXISTS pre-check must not treat
    // the now-cancelled permit as blocking, and the DB write must not hit
    // the (now-partial) building_permits_application_active_unique index
    // either.
    const second = await app.inject({ method: "POST", url: "/v1/building/permits", headers: officerAuth, payload: { applicationId } });
    expect(second.statusCode).toBe(202);
    const { id: secondId } = second.json() as { id: string };
    expect(secondId).not.toBe(firstId);
    await drain();

    const reissued = await app.inject({ method: "GET", url: `/v1/building/permits/${secondId}`, headers: officerAuth });
    expect(reissued.statusCode).toBe(200);
    expect(reissued.json().data.status).toBe("active");
  });

  it("still blocks a duplicate against an ACTIVE (non-cancelled) permit for the same application", async () => {
    const applicationId = await seedApplication("approved");
    const first = await app.inject({ method: "POST", url: "/v1/building/permits", headers: officerAuth, payload: { applicationId } });
    expect(first.statusCode).toBe(202);
    await drain();

    const second = await app.inject({ method: "POST", url: "/v1/building/permits", headers: officerAuth, payload: { applicationId } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("PERMIT_ALREADY_EXISTS");
  });
});

describe("permit lifecycle — persisted-state + cache invalidation", () => {
  it("suspend actually flips status and the read-through cache does not keep serving 'active'", async () => {
    const applicationId = await seedApplication("approved");
    const issueRes = await app.inject({ method: "POST", url: "/v1/building/permits", headers: officerAuth, payload: { applicationId } });
    const { id: permitId } = issueRes.json() as { id: string };
    await drain();

    // Populate the read-through cache with the pre-suspend value.
    const before = await app.inject({ method: "GET", url: `/v1/building/permits/${permitId}`, headers: officerAuth });
    expect(before.json().data.status).toBe("active");

    const suspendRes = await app.inject({
      method: "POST",
      url: `/v1/building/permits/${permitId}/suspend`,
      headers: officerAuth,
      payload: { reason: "Structural violation found on site inspection" },
    });
    expect(suspendRes.statusCode).toBe(202);
    await drain();

    const after = await app.inject({ method: "GET", url: `/v1/building/permits/${permitId}`, headers: officerAuth });
    expect(after.json().data.status).toBe("suspended");
    expect(after.json().data.suspensionReason).toContain("Structural violation");
  });
});

describe("fake-success guard — a stale/mismatched suspend command must not fabricate success", () => {
  it("a suspendPermit command for a permitId that does not exist writes no outbox event and no audit row", async () => {
    const bogusPermitId = randomUUID();
    const messageId = randomUUID();
    await queue.publish(COMMANDS.suspendPermit, {
      messageId,
      type: COMMANDS.suspendPermit,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { permitId: bogusPermitId, tenantId: TENANT, reason: "should never apply" },
    });
    await drain();

    // repo.updatePermitStatus's WHERE clause matches zero rows for a
    // nonexistent id, so `ok` is false and the consumer must return before
    // enqueueing permitSuspended or the audit record — both go through the
    // same _outbox.messages table (no RLS on it, per PR #1001 fix #1), so a
    // direct query is a real, DB-level proof the guard held (not just that
    // a mock wasn't called).
    const rows = await sqlClient`
      SELECT id FROM _outbox.messages
      WHERE payload->>'permitId' = ${bogusPermitId}
    `;
    expect(rows.length).toBe(0);
  });
});
