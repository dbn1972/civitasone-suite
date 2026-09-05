/**
 * Basic route-health smoke coverage (live DB) for the connections, billing,
 * and desludging modules — proves the primary write→read round trip works
 * for each, that 202 responses' ids match what the consumer actually
 * persisted, that unknown ids 404, and that role checks are enforced.
 * Complaints has its own dedicated file (complaints-flow.integration.test.ts)
 * because that's where the real bug was found and fixed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { registerConnectionConsumers } from "../src/modules/connections/consumer.js";
import { registerBillingConsumers } from "../src/modules/billing/consumer.js";
import { registerDesludgingConsumers } from "../src/modules/desludging/consumer.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0000-4000-8000-000000000002";
const USER = "bbbbbbbb-0000-4000-8000-000000000002";
const ADMIN = "cccccccc-0000-4000-8000-000000000002";

function token(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "test-session" }, SECRET, 3600);
}
// NOTE: createTenantTxHook reads the tenant id from the `x-tenant-id`
// REQUEST HEADER (normally injected by the gateway), not from the JWT `tid`
// claim -- app.inject() bypasses the gateway, so it must be set explicitly.
// See services/estab-service/tests/csmop-negative.test.ts for the same
// convention elsewhere in this repo.
const userAuth = { authorization: `Bearer ${token(USER, ["sewerage_user"])}`, "x-tenant-id": TENANT };
const adminAuth = { authorization: `Bearer ${token(ADMIN, ["sewerage_admin"])}`, "x-tenant-id": TENANT };

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerConnectionConsumers(queue);
  registerBillingConsumers(queue);
  registerDesludgingConsumers(queue);
});

afterAll(async () => {
  await app.close();
});

describe("connections — application lifecycle round trip", () => {
  it("apply → status walk to work_ordered → activate persists a connection", async () => {
    const applyRes = await app.inject({
      method: "POST",
      url: "/v1/sewerage/connections/apply",
      headers: userAuth,
      payload: { connectionClass: "domestic", propertyRef: "PROP-1", siteDetails: { plotNo: "12A" } },
    });
    expect(applyRes.statusCode).toBe(202);
    const applied = applyRes.json() as { id: string };
    await queue.drain();

    let current = (await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${applied.id}`, headers: userAuth })).json().data;
    expect(current.id).toBe(applied.id);
    expect(current.status).toBe("submitted");

    for (const next of ["feasibility_check", "estimate_issued", "payment_pending", "work_ordered"]) {
      const res = await app.inject({
        method: "POST",
        url: `/v1/sewerage/connections/applications/${applied.id}/status`,
        headers: adminAuth,
        payload: { status: next, version: current.version },
      });
      expect(res.statusCode).toBe(202);
      await queue.drain();
      current = (await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${applied.id}`, headers: userAuth })).json().data;
      expect(current.status).toBe(next);
    }

    const activateRes = await app.inject({
      method: "POST",
      url: `/v1/sewerage/connections/applications/${applied.id}/activate`,
      headers: adminAuth,
      payload: { version: current.version },
    });
    expect(activateRes.statusCode).toBe(202);
    await queue.drain();

    const finalApp = (await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${applied.id}`, headers: userAuth })).json().data;
    expect(finalApp.status).toBe("activated");

    const list = (await app.inject({ method: "GET", url: "/v1/sewerage/connections/applications?status=activated", headers: userAuth })).json();
    expect(list.data.some((a: { id: string }) => a.id === applied.id)).toBe(true);
  });

  it("404s for an unknown application id", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${randomUUID()}`, headers: userAuth });
    expect(res.statusCode).toBe(404);
  });

  it("non-admin cannot change application status (403)", async () => {
    const applyRes = await app.inject({
      method: "POST", url: "/v1/sewerage/connections/apply", headers: userAuth,
      payload: { connectionClass: "commercial" },
    });
    const applied = applyRes.json() as { id: string };
    await queue.drain();
    const current = (await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${applied.id}`, headers: userAuth })).json().data;

    const res = await app.inject({
      method: "POST",
      url: `/v1/sewerage/connections/applications/${applied.id}/status`,
      headers: userAuth,
      payload: { status: "feasibility_check", version: current.version },
    });
    expect(res.statusCode).toBe(403);
  });

  it("stale version is rejected with 409 (optimistic concurrency)", async () => {
    const applyRes = await app.inject({
      method: "POST", url: "/v1/sewerage/connections/apply", headers: userAuth,
      payload: { connectionClass: "industrial" },
    });
    const applied = applyRes.json() as { id: string };
    await queue.drain();

    const res = await app.inject({
      method: "POST",
      url: `/v1/sewerage/connections/applications/${applied.id}/status`,
      headers: adminAuth,
      payload: { status: "feasibility_check", version: 99 },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("billing — generate → pay round trip", () => {
  it("generates a bill and pays it", async () => {
    const connectionId = randomUUID();
    const genRes = await app.inject({
      method: "POST",
      url: "/v1/sewerage/bills",
      headers: adminAuth,
      payload: { connectionId, billingPeriod: "2026-08", amountMinor: 45000, dueDate: "2026-09-30" },
    });
    expect(genRes.statusCode).toBe(202);
    const bill = genRes.json() as { id: string };
    await queue.drain();

    let current = (await app.inject({ method: "GET", url: `/v1/sewerage/bills/${bill.id}`, headers: userAuth })).json().data;
    expect(current.status).toBe("generated");
    expect(current.connectionId).toBe(connectionId);

    const payRes = await app.inject({
      method: "POST",
      url: `/v1/sewerage/bills/${bill.id}/pay`,
      headers: userAuth,
      payload: { paymentRef: "PAYREF-1", version: current.version },
    });
    expect(payRes.statusCode).toBe(202);
    await queue.drain();

    current = (await app.inject({ method: "GET", url: `/v1/sewerage/bills/${bill.id}`, headers: userAuth })).json().data;
    expect(current.status).toBe("paid");
    expect(current.paymentRef).toBe("PAYREF-1");
  });

  it("rejects paying an already-paid bill", async () => {
    const connectionId = randomUUID();
    const genRes = await app.inject({
      method: "POST", url: "/v1/sewerage/bills", headers: adminAuth,
      payload: { connectionId, billingPeriod: "2026-09", amountMinor: 1000, dueDate: "2026-10-31" },
    });
    const bill = genRes.json() as { id: string };
    await queue.drain();
    let current = (await app.inject({ method: "GET", url: `/v1/sewerage/bills/${bill.id}`, headers: userAuth })).json().data;

    await app.inject({
      method: "POST", url: `/v1/sewerage/bills/${bill.id}/pay`, headers: userAuth,
      payload: { paymentRef: "P1", version: current.version },
    });
    await queue.drain();
    current = (await app.inject({ method: "GET", url: `/v1/sewerage/bills/${bill.id}`, headers: userAuth })).json().data;

    const res = await app.inject({
      method: "POST", url: `/v1/sewerage/bills/${bill.id}/pay`, headers: userAuth,
      payload: { paymentRef: "P2", version: current.version },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("ALREADY_PAID");
  });
});

describe("desludging — book → schedule → dispatch → complete round trip", () => {
  it("walks a booking through its full lifecycle", async () => {
    const bookRes = await app.inject({
      method: "POST",
      url: "/v1/sewerage/desludging",
      headers: userAuth,
      payload: { tankCapacityLitres: 3000, requestedDate: "2026-09-10", requestedSlot: "morning" },
    });
    expect(bookRes.statusCode).toBe(202);
    const booking = bookRes.json() as { id: string };
    await queue.drain();

    let current = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${booking.id}`, headers: userAuth })).json().data;
    expect(current.status).toBe("requested");

    const scheduleRes = await app.inject({
      method: "POST", url: `/v1/sewerage/desludging/${booking.id}/schedule`, headers: adminAuth,
      payload: { vehicleId: "VEH-9", version: current.version },
    });
    expect(scheduleRes.statusCode).toBe(202);
    await queue.drain();
    current = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${booking.id}`, headers: userAuth })).json().data;
    expect(current.status).toBe("scheduled");
    expect(current.vehicleId).toBe("VEH-9");

    const dispatchRes = await app.inject({
      method: "POST", url: `/v1/sewerage/desludging/${booking.id}/dispatch`, headers: adminAuth,
      payload: { version: current.version },
    });
    expect(dispatchRes.statusCode).toBe(202);
    await queue.drain();
    current = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${booking.id}`, headers: userAuth })).json().data;
    expect(current.status).toBe("dispatched");

    const completeRes = await app.inject({
      method: "POST", url: `/v1/sewerage/desludging/${booking.id}/complete`, headers: adminAuth,
      payload: { version: current.version },
    });
    expect(completeRes.statusCode).toBe(202);
    await queue.drain();
    current = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${booking.id}`, headers: userAuth })).json().data;
    expect(current.status).toBe("completed");
    expect(current.feePaid).toBe(true);
  });

  it("cancel is rejected once completed (terminal state)", async () => {
    const bookRes = await app.inject({
      method: "POST", url: "/v1/sewerage/desludging", headers: userAuth,
      payload: { tankCapacityLitres: 1000 },
    });
    const booking = bookRes.json() as { id: string };
    await queue.drain();
    let current = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${booking.id}`, headers: userAuth })).json().data;

    await app.inject({ method: "POST", url: `/v1/sewerage/desludging/${booking.id}/schedule`, headers: adminAuth, payload: { vehicleId: "V1", version: current.version } });
    await queue.drain();
    current = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${booking.id}`, headers: userAuth })).json().data;

    await app.inject({ method: "POST", url: `/v1/sewerage/desludging/${booking.id}/dispatch`, headers: adminAuth, payload: { version: current.version } });
    await queue.drain();
    current = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${booking.id}`, headers: userAuth })).json().data;

    await app.inject({ method: "POST", url: `/v1/sewerage/desludging/${booking.id}/complete`, headers: adminAuth, payload: { version: current.version } });
    await queue.drain();
    current = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${booking.id}`, headers: userAuth })).json().data;

    const cancelRes = await app.inject({
      method: "POST", url: `/v1/sewerage/desludging/${booking.id}/cancel`, headers: userAuth,
      payload: { version: current.version },
    });
    expect(cancelRes.statusCode).toBe(422);
  });

  it("404s for an unknown booking id", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${randomUUID()}`, headers: userAuth });
    expect(res.statusCode).toBe(404);
  });
});

describe("auth — unauthenticated requests are rejected", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/sewerage/desludging" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});
