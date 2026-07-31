/**
 * RTI module route-level tests.
 * Covers: happy path, 400, 401, 403, 404, 409 for all RTI endpoints.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const RTI_ID = "cccccccc-0001-4000-8000-000000000001";
const PIO_ID = "dddddddd-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  listRti: vi.fn(),
  getRti: vi.fn(),
  insertRti: vi.fn(),
  transitionRti: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args, ...w) }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args) }),
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
    insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v) }),
    execute: (q: unknown) => H.execute(q),
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => {} },
}));

vi.mock("../src/modules/rti/repo.js", () => ({
  listRti: (...a: unknown[]) => H.listRti(...a),
  getRti: (...a: unknown[]) => H.getRti(...a),
  insertRti: (...a: unknown[]) => H.insertRti(...a),
  transitionRti: (...a: unknown[]) => H.transitionRti(...a),
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

const rtiRow = (over: Record<string, unknown> = {}) => ({
  id: RTI_ID, tenantId: TENANT,
  referenceNo: "RTI-2026-001",
  applicantName: "Rajesh Kumar",
  applicantContact: "rajesh@example.com",
  subject: "Information about project status",
  requestText: "Please provide details of ongoing projects.",
  receivedDate: "2026-06-01",
  dueDate: "2026-07-01",
  pioId: null,
  status: "filed",
  responseText: null, respondedDate: null,
  appealText: null, appealDate: null,
  closedDate: null,
  createdAt: new Date(), updatedAt: new Date(),
  createdBy: USER, updatedBy: USER, version: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.listRti.mockResolvedValue([rtiRow()]);
  H.getRti.mockResolvedValue(rtiRow());
  H.insertRti.mockResolvedValue(undefined);
  H.transitionRti.mockResolvedValue(rtiRow());
  H.insert.mockResolvedValue(undefined);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ═══════════════════ GET /v1/hrms/rti/requests ═══════════════════
describe("GET /v1/hrms/rti/requests", () => {
  it("lists RTI requests (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].overdue).toBeDefined();
    expect(r.json().data[0].daysToDue).toBeDefined();
    await app.close();
  });

  it("marks overdue for open requests past due date", async () => {
    H.listRti.mockResolvedValue([rtiRow({ status: "filed", dueDate: "2020-01-01" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0].overdue).toBe(true);
    expect(r.json().data[0].daysToDue).toBeLessThan(0);
    await app.close();
  });

  it("does not mark overdue for closed requests past due date", async () => {
    H.listRti.mockResolvedValue([rtiRow({ status: "closed", dueDate: "2020-01-01" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0].overdue).toBe(false);
    await app.close();
  });

  it("does not mark overdue for responded requests", async () => {
    H.listRti.mockResolvedValue([rtiRow({ status: "responded", dueDate: "2020-01-01" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0].overdue).toBe(false);
    await app.close();
  });

  it("marks not overdue for open requests before due date", async () => {
    H.listRti.mockResolvedValue([rtiRow({ status: "assigned", dueDate: "2099-12-31" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0].overdue).toBe(false);
    expect(r.json().data[0].daysToDue).toBeGreaterThan(0);
    await app.close();
  });

  it("allows hr_officer role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests", headers: auth(USER, ["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("allows super_admin role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests", headers: auth(USER, ["super_admin"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns empty data array when no requests exist", async () => {
    H.listRti.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ═══════════════════ GET /v1/hrms/rti/requests/:id ═══════════════════
describe("GET /v1/hrms/rti/requests/:id", () => {
  it("reads a single RTI request (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/rti/requests/${RTI_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(RTI_ID);
    expect(r.json().data.overdue).toBeDefined();
    await app.close();
  });

  it("computes overdue=true for open request past due date", async () => {
    H.getRti.mockResolvedValue(rtiRow({ status: "assigned", dueDate: "2020-01-01" }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/rti/requests/${RTI_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.overdue).toBe(true);
    await app.close();
  });

  it("computes overdue=false for closed request past due date", async () => {
    H.getRti.mockResolvedValue(rtiRow({ status: "closed", dueDate: "2020-01-01" }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/rti/requests/${RTI_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.overdue).toBe(false);
    await app.close();
  });

  it("computes positive daysToDue for future due date", async () => {
    H.getRti.mockResolvedValue(rtiRow({ status: "filed", dueDate: "2099-12-31" }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/rti/requests/${RTI_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.daysToDue).toBeGreaterThan(0);
    expect(r.json().data.overdue).toBe(false);
    await app.close();
  });

  it("returns 400 for invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests/not-a-uuid", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/rti/requests/${RTI_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/rti/requests/${RTI_ID}`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when not found", async () => {
    H.getRti.mockResolvedValue(undefined);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/rti/requests/${RTI_ID}`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});

// ═══════════════════ POST /v1/hrms/rti/requests ═══════════════════
describe("POST /v1/hrms/rti/requests", () => {
  const payload = {
    referenceNo: "RTI-2026-002",
    applicantName: "Sita Devi",
    subject: "Staff count query",
    requestText: "How many employees in this department?",
    receivedDate: "2026-06-15",
  };

  it("files a new RTI request (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("filed");
    expect(body.dueDate).toBe("2026-07-15"); // 30 days default SLA
    await app.close();
  });

  it("computes custom SLA days", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(), payload: { ...payload, slaDays: 15 } });
    expect(r.statusCode).toBe(201);
    expect(r.json().dueDate).toBe("2026-06-30");
    await app.close();
  });

  it("accepts optional applicantContact field", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(), payload: { ...payload, applicantContact: "sita@example.com" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("filed");
    await app.close();
  });

  it("computes SLA correctly for month boundary", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(), payload: { ...payload, receivedDate: "2026-01-31", slaDays: 30 } });
    expect(r.statusCode).toBe(201);
    // Jan 31 + 30 days = Mar 2 (non-leap year 2026)
    expect(r.json().dueDate).toBe("2026-03-02");
    await app.close();
  });

  it("handles slaDays = 1", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(), payload: { ...payload, receivedDate: "2026-06-15", slaDays: 1 } });
    expect(r.statusCode).toBe(201);
    expect(r.json().dueDate).toBe("2026-06-16");
    await app.close();
  });

  it("returns 400 on invalid body (missing required fields)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(), payload: { referenceNo: "X" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 on invalid date format", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(), payload: { ...payload, receivedDate: "not-a-date" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 when slaDays exceeds max (60)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(), payload: { ...payload, slaDays: 61 } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 when slaDays is zero", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(), payload: { ...payload, slaDays: 0 } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 when slaDays is negative", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(), payload: { ...payload, slaDays: -5 } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ═══════════════════ POST /v1/hrms/rti/requests/:id/assign ═══════════════════
describe("POST /v1/hrms/rti/requests/:id/assign", () => {
  it("assigns a PIO (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/assign`, headers: auth(), payload: { pioId: PIO_ID } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("assigned");
    expect(r.json().pioId).toBe(PIO_ID);
    await app.close();
  });

  it("returns 400 for invalid pioId (not UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/assign`, headers: auth(), payload: { pioId: "not-uuid" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/assign`, payload: { pioId: PIO_ID } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/assign`, headers: auth(USER, ["employee"]), payload: { pioId: PIO_ID } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 409 when state is not filed", async () => {
    H.transitionRti.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/assign`, headers: auth(), payload: { pioId: PIO_ID } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INVALID_STATE");
    await app.close();
  });
});

// ═══════════════════ POST /v1/hrms/rti/requests/:id/respond ═══════════════════
describe("POST /v1/hrms/rti/requests/:id/respond", () => {
  const payload = { responseText: "Here is the requested information.", respondedDate: "2026-06-20" };

  it("responds to an RTI request (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/respond`, headers: auth(), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("responded");
    await app.close();
  });

  it("returns 400 for missing responseText", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/respond`, headers: auth(), payload: { respondedDate: "2026-06-20" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/respond`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/respond`, headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 409 when state doesn't allow response", async () => {
    H.transitionRti.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/respond`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INVALID_STATE");
    await app.close();
  });
});

// ═══════════════════ POST /v1/hrms/rti/requests/:id/appeal ═══════════════════
describe("POST /v1/hrms/rti/requests/:id/appeal", () => {
  const payload = { appealText: "The response is incomplete.", appealDate: "2026-07-01" };

  it("appeals a responded RTI request (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/appeal`, headers: auth(), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("appealed");
    await app.close();
  });

  it("returns 400 for missing appealText", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/appeal`, headers: auth(), payload: { appealDate: "2026-07-01" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/appeal`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/appeal`, headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 409 when request is not in responded state", async () => {
    H.transitionRti.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/appeal`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INVALID_STATE");
    await app.close();
  });
});

// ═══════════════════ POST /v1/hrms/rti/requests/:id/close ═══════════════════
describe("POST /v1/hrms/rti/requests/:id/close", () => {
  const payload = { closedDate: "2026-07-10" };

  it("closes a responded/appealed RTI request (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/close`, headers: auth(), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("closed");
    await app.close();
  });

  it("returns 400 for invalid closedDate", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/close`, headers: auth(), payload: { closedDate: "invalid" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/close`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/close`, headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 409 when request is not closeable", async () => {
    H.transitionRti.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${RTI_ID}/close`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INVALID_STATE");
    await app.close();
  });
});
