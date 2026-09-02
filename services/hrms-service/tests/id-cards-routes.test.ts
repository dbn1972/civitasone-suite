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

vi.mock("../src/shared/db.js", () => {
  // suspend/revoke/reactivate now run their UPDATE inside withRawTenantGuc
  // (a real fix for the RLS-GUC gap: hrms.id_cards is RLS ENABLEd + FORCEd,
  // and plain sqlPool.query never set app.tenant_id, so those UPDATEs always
  // matched zero rows against a real DB — see routes.ts's top-of-file
  // comment). withRawTenantGuc calls `sqlClient.begin()` then, as its very
  // first statement, a tagged-template `set_config(...)` bookkeeping call
  // before handing the transaction to the route's own `tx.unsafe(text,
  // params)` query — both must be mocked so that internal call doesn't
  // consume a mockResolvedValueOnce() queued for the route's real query.
  // app.ts's onResponse hook fire-and-forgets shared/audit.ts's writeAuditLog
  // for every mutating (non-GET) 2xx response via setImmediate — unawaited by
  // the request handler, so it can still be in flight when the NEXT test's
  // beforeEach queues its own mockResolvedValueOnce. writeAuditLog also calls
  // `sqlClient.unsafe(...)` (an INSERT INTO audit.hr_action_log), which would
  // otherwise silently steal a once-value queued for a real route query in a
  // later test. Recognize and short-circuit it the same way set_config is
  // short-circuited below, so it never touches H.poolQuery's queue.
  const isAuditInsert = (text: unknown) => typeof text === "string" && text.includes("audit.hr_action_log");
  const sqlClientFn = (...args: unknown[]) => {
    const [strings] = args as [TemplateStringsArray];
    if (strings?.[0]?.includes("set_config")) return Promise.resolve([]);
    return H.poolQuery(...args);
  };
  sqlClientFn.end = async () => {};
  sqlClientFn.unsafe = (...a: unknown[]) => (isAuditInsert(a[0]) ? Promise.resolve([]) : H.poolQuery(...a));
  sqlClientFn.begin = async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn);
  return {
    // buildApp() wires a blanket onRequest hook (createTenantTxHook(db), for
    // RLS tenant scoping) that runs for every request regardless of which
    // module's routes handle it, so `db.transaction` must exist and work even
    // though the id-cards routes under test only ever use raw `sqlPool.query`
    // (issue/list/me/verify) or `sqlClient`+withRawTenantGuc (suspend/revoke/
    // reactivate).
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
    sqlClient: sqlClientFn,
    sqlPool: { query: (...a: unknown[]) => H.poolQuery(...a) },
  };
});

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
  // Hybrid default: an empty array carrying both the `sqlPool.query` shape
  // ({rows, rowCount}, for issue/list/me/verify) and the raw postgres.js
  // `.unsafe()` shape (an array with a `.count`, for suspend/revoke/
  // reactivate's withRawTenantGuc path) — every explicit test below queues
  // its own mockResolvedValueOnce, so this only covers incidental extra calls.
  H.poolQuery.mockResolvedValue(Object.assign([], { rows: [], rowCount: 0, count: 0 }));
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
    H.poolQuery.mockResolvedValueOnce(Object.assign([], { count: 1 })); // UPDATE via withRawTenantGuc/tx.unsafe
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
    H.poolQuery.mockResolvedValueOnce(Object.assign([], { count: 0 })); // UPDATE via withRawTenantGuc/tx.unsafe
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
    H.poolQuery.mockResolvedValueOnce(Object.assign([], { count: 1 })); // UPDATE via withRawTenantGuc/tx.unsafe
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
    H.poolQuery.mockResolvedValueOnce(Object.assign([], { count: 0 })); // UPDATE via withRawTenantGuc/tx.unsafe
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${CARD_ID}/revoke`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(404);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("PATCH /v1/hrms/id-cards/:id/reactivate", () => {
  it("reactivates a suspended card (200) and publishes idCardReactivate", async () => {
    H.poolQuery.mockResolvedValueOnce(Object.assign([], { count: 1 })); // UPDATE via withRawTenantGuc/tx.unsafe
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
    H.poolQuery.mockResolvedValueOnce(Object.assign([], { count: 0 })); // UPDATE via withRawTenantGuc/tx.unsafe
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${CARD_ID}/reactivate`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });
});
