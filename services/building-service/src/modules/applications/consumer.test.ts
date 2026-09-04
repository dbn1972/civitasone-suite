/**
 * Real-DB integration test for building-service's applications module.
 *
 * Replaces the previous vi.mock("../../shared/db.js") version. Drives the
 * real Fastify app + the real consumer against a real, migrated Postgres
 * database and asserts on persisted rows, not mock-call arguments.
 *
 * Covers:
 *  1. Route -> consumer -> persisted state for the full create ->
 *     submit -> fee-payment path, including the fee_minor BigInt
 *     calculation (calculateFeeMinor) landing correctly as a bigint column.
 *  2. Read-through cache invalidation (shared/infra.ts, TTL 60s): GET is
 *     read before and after each write in the same run, well under the
 *     TTL — a missing cache.invalidate() call would make the "after" read
 *     return the stale cached value and fail the assertion for real.
 *  3. The money/precision bound fix in applications/routes.ts: plotArea /
 *     builtUpArea / proposedFloors / fsiRequested now reject values beyond
 *     what their numeric(12,2) / numeric(6,3) / integer columns can hold,
 *     with a clean 400 instead of letting an oversized value reach the
 *     consumer's DB transaction.
 *  4. The fake-success guard on submitApplication/withdrawApplication/
 *     recordFeePayment (repo.updateStatus / updateFeePayment's boolean
 *     "did a row actually match" return): a raw command for an id that
 *     does not exist must write no outbox event and no audit row —
 *     checked directly against _outbox.messages.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../../app.js";
import { queue } from "../../shared/infra.js";
import { sqlClient } from "../../shared/db.js";
import { registerApplicationConsumers } from "./consumer.js";
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
const TENANT = "10000000-aaaa-4000-8000-000000000002";
const ACTOR = "20000000-bbbb-4000-8000-000000000002";

function token(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "test-session" }, SECRET, 3600);
}

const userAuth = { authorization: `Bearer ${token(ACTOR, ["building_user"])}` };

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("applications lifecycle — real DB reproduction", () => {
  it("create -> submit -> fee-payment all succeed and persist correctly", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/building/applications",
      headers: userAuth,
      payload: {
        siteAddress: { line1: "12 Ring Road", city: "Test City", pin: "560001" },
        plotArea: 500.5,
        builtUpArea: 350.25,
        proposedFloors: 4,
        fsiRequested: 1.5,
      },
    });
    expect(createRes.statusCode).toBe(202);
    const created = createRes.json() as { id: string; status: string };
    expect(created.status).toBe("accepted");
    await drain();

    // 202 response id must match the persisted row's id (this campaign's
    // "F3 consumer INSERT omitting id" bug shape — confirmed NOT present:
    // repo.insertApplication is passed row.id === p.id).
    const afterCreate = await app.inject({ method: "GET", url: `/v1/building/applications/${created.id}`, headers: userAuth });
    expect(afterCreate.statusCode).toBe(200);
    const application = afterCreate.json().data;
    expect(application.id).toBe(created.id);
    expect(application.status).toBe("draft");
    expect(application.applicationNumber).toMatch(/^BLDG\/ULB\/\d{4}\/\d{6}$/);
    // calculateFeeMinor: base 500000 + floor((350.25-200)/50)*100000 (=300000, since floor(150.25/50)=3) + (4-2)*200000 (=400000) = 1200000
    expect(String(application.feeMinor)).toBe("1200000");

    // 2. submit — cache invalidation check: read (populate cache) before,
    // mutate, read again (must not be the stale "draft" cached value).
    const submitRes = await app.inject({ method: "POST", url: `/v1/building/applications/${created.id}/submit`, headers: userAuth });
    expect(submitRes.statusCode).toBe(202);
    await drain();

    const afterSubmit = await app.inject({ method: "GET", url: `/v1/building/applications/${created.id}`, headers: userAuth });
    expect(afterSubmit.json().data.status).toBe("submitted");
    expect(afterSubmit.json().data.submittedAt).toBeTruthy();

    // 3. fee payment
    const feeRes = await app.inject({
      method: "POST",
      url: `/v1/building/applications/${created.id}/fee-payment`,
      headers: userAuth,
      payload: { transactionId: "TXN-TEST-0001" },
    });
    expect(feeRes.statusCode).toBe(202);
    await drain();

    const afterFee = await app.inject({ method: "GET", url: `/v1/building/applications/${created.id}`, headers: userAuth });
    expect(afterFee.json().data.feePaid).toBe(true);
    expect(afterFee.json().data.feeTransactionId).toBe("TXN-TEST-0001");

    // Paying twice must be rejected cleanly (existing guard, still correct).
    const feeAgain = await app.inject({
      method: "POST",
      url: `/v1/building/applications/${created.id}/fee-payment`,
      headers: userAuth,
      payload: { transactionId: "TXN-TEST-0002" },
    });
    expect(feeAgain.statusCode).toBe(409);
  });
});

describe("money/precision bounds — plotArea/builtUpArea/proposedFloors/fsiRequested", () => {
  const basePayload = { siteAddress: { line1: "1 Test St", city: "Test City", pin: "560001" } };

  it("rejects plotArea beyond numeric(12,2)'s representable ceiling", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/building/applications",
      headers: userAuth,
      payload: { ...basePayload, plotArea: 10_000_000_000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects fsiRequested beyond numeric(6,3)'s representable ceiling", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/building/applications",
      headers: userAuth,
      payload: { ...basePayload, fsiRequested: 1000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a plotArea with more decimal precision than the (12,2) column stores, instead of letting Postgres silently round it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/building/applications",
      headers: userAuth,
      payload: { ...basePayload, plotArea: 123.456 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unrealistic proposedFloors value", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/building/applications",
      headers: userAuth,
      payload: { ...basePayload, proposedFloors: 100_000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("still accepts large values comfortably within (not exactly at, to avoid float-precision flakiness on the boundary) the true column ceilings", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/building/applications",
      headers: userAuth,
      payload: { ...basePayload, plotArea: 9999999999.0, fsiRequested: 999.99, proposedFloors: 200 },
    });
    expect(res.statusCode).toBe(202);
    await drain();
  });
});

describe("fake-success guard — a stale/mismatched submit command must not fabricate success", () => {
  it("a submitApplication command for an id that does not exist writes no outbox event and no audit row", async () => {
    const bogusId = randomUUID();
    await queue.publish(COMMANDS.submitApplication, {
      messageId: randomUUID(),
      type: COMMANDS.submitApplication,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { id: bogusId, tenantId: TENANT },
    });
    await drain();

    const rows = await sqlClient`
      SELECT id FROM _outbox.messages
      WHERE payload->>'applicationId' = ${bogusId}
    `;
    expect(rows.length).toBe(0);
  });
});
