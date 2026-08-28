/**
 * ID card route-level tests.
 *
 * No test file existed for this module before this HR-A deep-verify pass.
 * These cover the two concrete bugs found and fixed here:
 *  - POST /v1/hrms/id-cards (issue) had no requireRole check at all, unlike
 *    every other mutating handler in this file -- any authenticated user of
 *    any role could issue a fully valid, QR-signed ID card for anyone.
 *  - PATCH .../suspend, .../revoke, .../reactivate replied 200 "success"
 *    unconditionally even when their UPDATE matched zero rows (unknown id,
 *    or the card was not in the expected starting state) -- a false-success
 *    response.
 * Also covers the previously-orphaned audit consumer: registerIdCardConsumers
 * (../src/modules/id-cards/consumer.js, registered in worker.ts) subscribes
 * to COMMANDS.idCardIssue/Suspend/Revoke/Reactivate, but nothing published
 * those commands anywhere in the codebase until this pass wired it up here.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const CARD_ID = "cccccccc-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  publish: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/db.js", () => ({
  // buildApp() wires a blanket onRequest hook (createTenantTxHook(db), for
  // RLS tenant scoping) that runs for every request regardless of which
  // module's routes handle it, so `db.transaction` must exist and work even
  // though the id-cards routes under test only ever use raw `sqlPool.query`.
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  sqlClient: { end: async () => {} },
  sqlPool: { query: (...a: unknown[]) => H.poolQuery(...a) },
}));

vi.mock("../src/shared/infra.js", () => ({
  // buildApp() also wires registerOpsRoutes(), which reads `cache` for its
  // health-check payload regardless of which module's routes are under test.
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: { publish: (...a: unknown[]) => H.publish(...a) },
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({
  authorization: `Bearer ${tok(sub, roles)}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

describe("POST /v1/hrms/id-cards", () => {
  const payload = {
    holderName: "Test Holder",
    cardType: "employee" as const,
    validUntil: "2027-01-01",
  };

  it("issues a card for hr_admin (201) and publishes idCardIssue for the audit consumer", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [{ seq: 1 }], rowCount: 1 }); // seq lookup
    H.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // issuer name lookup
    H.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // insert
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/id-cards", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("active");

    expect(H.publish).toHaveBeenCalledOnce(); // no employeeId -> no separate notification.send
    const [topic, envelope] = H.publish.mock.calls[0];
    expect(topic).toBe(COMMANDS.idCardIssue);
    expect(envelope.payload).toMatchObject({
      holderName: "Test Holder", cardType: "employee", validUntil: "2027-01-01",
    });
    await app.close();
  });

  it("returns 403 for a plain employee role (regression: this endpoint had no requireRole at all)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/id-cards", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/id-cards", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 400 for an invalid body", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/id-cards", headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /v1/hrms/id-cards", () => {
  it("lists cards (200)", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [{ id: CARD_ID, holder_name: "Test" }], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/id-cards", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });
});

describe("PATCH /v1/hrms/id-cards/:id/suspend", () => {
  it("suspends an active card (200) and publishes idCardSuspend", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${CARD_ID}/suspend`, headers: auth(), payload: { reason: "lost" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("suspended");
    expect(H.publish).toHaveBeenCalledWith(COMMANDS.idCardSuspend, expect.objectContaining({
      payload: { id: CARD_ID, tenantId: TENANT, reason: "lost" },
    }));
    await app.close();
  });

  it("returns 404 when no active card matched (regression: previously replied 200 unconditionally)", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${CARD_ID}/suspend`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(404);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 403 for a plain employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${CARD_ID}/suspend`, headers: auth(USER, ["employee"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("PATCH /v1/hrms/id-cards/:id/revoke", () => {
  it("revokes an active/suspended card (200) and publishes idCardRevoke", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${CARD_ID}/revoke`, headers: auth(), payload: { reason: "terminated" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("revoked");
    expect(H.publish).toHaveBeenCalledWith(COMMANDS.idCardRevoke, expect.objectContaining({
      payload: { id: CARD_ID, tenantId: TENANT, reason: "terminated" },
    }));
    await app.close();
  });

  it("returns 404 when no matching card (regression: previously replied 200 unconditionally)", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${CARD_ID}/revoke`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(404);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("PATCH /v1/hrms/id-cards/:id/reactivate", () => {
  it("reactivates a suspended card (200) and publishes idCardReactivate", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${CARD_ID}/reactivate`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("active");
    expect(H.publish).toHaveBeenCalledWith(COMMANDS.idCardReactivate, expect.objectContaining({
      payload: { id: CARD_ID, tenantId: TENANT },
    }));
    await app.close();
  });

  it("returns 404 when no suspended card matched (regression: previously replied 200 unconditionally)", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${CARD_ID}/reactivate`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });
});
