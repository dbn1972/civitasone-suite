/**
 * Apprentice stipend module — comprehensive route-level tests.
 * Covers: happy path, 400, 401, 403, 404, 409 for all endpoints.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const CHECKER = "aaaaaaaa-2222-4000-8000-000000000002";
const APPR_EMP = "bbbbbbbb-0001-4000-8000-000000000001";
const APR_ID = "cccccccc-0001-4000-8000-000000000001";
const STP_ID = "dddddddd-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  // repo mocks
  insertApprenticeship: vi.fn(),
  findApprenticeship: vi.fn(),
  updateApprenticeship: vi.fn(),
  listApprenticeships: vi.fn(),
  insertStipend: vi.fn(),
  findStipend: vi.fn(),
  findStipendByMonth: vi.fn(),
  updateStipend: vi.fn(),
  listStipendsByApprenticeship: vi.fn(),
  listStipendsByStatus: vi.fn(),
  // outbox
  enqueueMock: vi.fn(),
  // engagement policy
  loadResolverMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({
            limit: (n: unknown) => H.selectFrom(...args, ...w),
          }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({
        limit: (n: unknown) => H.selectFrom(...args),
      }),
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({
      set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }),
    }),
    insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v) }),
    execute: (q: unknown) => H.execute(q),
  };
  return {
    db: {
      transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", async () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
  },
  // A real in-memory queue, not a no-op: these routes only PUBLISH, and the row
  // is written by the F3 consumer. With `publish: async () => {}` the consumer
  // never ran, so the repo mocks below could not tell a working write from a
  // crashing one.
  queue: new (await import("@civitasone/queue")).MemoryQueue(),
}));

vi.mock("../src/modules/apprentice-stipend/repo.js", () => ({
  insertApprenticeship: (...a: unknown[]) => H.insertApprenticeship(...a),
  findApprenticeship: (...a: unknown[]) => H.findApprenticeship(...a),
  updateApprenticeship: (...a: unknown[]) => H.updateApprenticeship(...a),
  listApprenticeships: (...a: unknown[]) => H.listApprenticeships(...a),
  insertStipend: (...a: unknown[]) => H.insertStipend(...a),
  findStipend: (...a: unknown[]) => H.findStipend(...a),
  findStipendByMonth: (...a: unknown[]) => H.findStipendByMonth(...a),
  updateStipend: (...a: unknown[]) => H.updateStipend(...a),
  listStipendsByApprenticeship: (...a: unknown[]) =>
    H.listStipendsByApprenticeship(...a),
  listStipendsByStatus: (...a: unknown[]) => H.listStipendsByStatus(...a),
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
  markProcessed: async () => true,
  startRelay: async () => {},
}));

vi.mock("../src/modules/employee/engagement-policy.js", async (io) => {
  const actual = await io<Record<string, unknown>>();
  return {
    ...actual,
    loadTypeResolver: (...a: unknown[]) => H.loadResolverMock(...a),
  };
});

import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { buildTypeResolver } from "../src/modules/employee/engagement-policy.js";
import { registerF3_apprentice_stipend_Consumers } from "../src/modules/apprentice-stipend/f3-consumer.js";

registerF3_apprentice_stipend_Consumers(queue);

/** Await the in-memory queue's fan-out so the consumer's write has happened. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}

const CANON = [
  { category: "apprentice", eligibleForPayroll: false },
  { category: "pay_scale", eligibleForPayroll: true },
];

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({
  authorization: `Bearer ${tok(sub, roles)}`,
});

function appr(over: Record<string, unknown> = {}) {
  return {
    id: APR_ID, tenantId: TENANT, apprenticeId: APPR_EMP,
    napsId: "NAPS-001", trade: "electrician",
    qualification: "iti", status: "active",
    monthlyStipendMinor: 500_000n, napsReimbPctBps: 2500,
    napsReimbCapMinor: 150_000n,
    trainingStart: "2026-04-01", trainingEnd: null,
    createdBy: USER, updatedBy: USER, version: 1,
    ...over,
  };
}

function stipend(over: Record<string, unknown> = {}) {
  return {
    id: STP_ID, tenantId: TENANT, apprenticeshipId: APR_ID,
    month: "2026-05", workingDays: 26, daysPresent: 26,
    monthlyStipendMinor: 500_000n,
    napsReimbPctBps: 2500, napsReimbCapMinor: 150_000n,
    grossStipendMinor: 500_000n, napsReimbMinor: 125_000n,
    employerCostMinor: 375_000n,
    status: "verified", verifiedBy: USER, verifiedAt: new Date(),
    approvedBy: null, approvedAt: null,
    paymentRef: null, paidAt: null,
    createdBy: USER, updatedBy: USER, version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: employee is an apprentice type
  H.selectFrom.mockResolvedValue([
    { id: APPR_EMP, tenantId: TENANT, employeeType: "apprentice", napsId: "NAPS-001" },
  ]);
  H.loadResolverMock.mockResolvedValue(buildTypeResolver([], CANON));
  H.insertApprenticeship.mockResolvedValue(undefined);
  H.findApprenticeship.mockResolvedValue(appr());
  H.updateApprenticeship.mockResolvedValue(undefined);
  H.listApprenticeships.mockResolvedValue([appr()]);
  H.insertStipend.mockResolvedValue(undefined);
  H.findStipend.mockResolvedValue(stipend());
  H.findStipendByMonth.mockResolvedValue(null);
  H.updateStipend.mockResolvedValue(undefined);
  H.listStipendsByApprenticeship.mockResolvedValue([]);
  H.listStipendsByStatus.mockResolvedValue([]);
  H.enqueueMock.mockResolvedValue(undefined);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue({ rowCount: 1 });
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ═══════════════════ POST /v1/hrms/apprenticeships ═══════════════════
describe("POST /v1/hrms/apprenticeships", () => {
  const payload = {
    apprenticeId: APPR_EMP, qualification: "iti",
    monthlyStipendMinor: 500000, trainingStart: "2026-04-01",
  };

  it("enrols an apprentice (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apprenticeships", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("active");
    await drainF3();
    expect(H.insertApprenticeship).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns 400 for missing required fields", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apprenticeships", headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 for invalid date format", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apprenticeships", headers: auth(), payload: { ...payload, trainingStart: "bad" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apprenticeships", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apprenticeships", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when employee not found", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apprenticeships", headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns 409 when employee is payroll-eligible", async () => {
    H.selectFrom.mockResolvedValue([
      { id: APPR_EMP, tenantId: TENANT, employeeType: "pay_scale", napsId: null },
    ]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apprenticeships", headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_AN_APPRENTICE");
    await app.close();
  });
});

// ═══════════════════ GET /v1/hrms/apprenticeships ═══════════════════
describe("GET /v1/hrms/apprenticeships", () => {
  it("lists apprenticeships (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apprenticeships", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apprenticeships" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apprenticeships", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ═══════════════════ GET /v1/hrms/apprenticeships/:id ═══════════════════
describe("GET /v1/hrms/apprenticeships/:id", () => {
  it("reads an apprenticeship (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apprenticeships/${APR_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 400 for invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apprenticeships/not-uuid", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 when not found", async () => {
    H.findApprenticeship.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apprenticeships/${APR_ID}`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});

// ═══════════════════ PATCH /v1/hrms/apprenticeships/:id ═══════════════════
describe("PATCH /v1/hrms/apprenticeships/:id", () => {
  it("updates an apprenticeship (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/apprenticeships/${APR_ID}`, headers: auth(), payload: { status: "completed" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("completed");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/apprenticeships/${APR_ID}`, payload: { status: "completed" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/apprenticeships/${APR_ID}`, headers: auth(USER, ["employee"]), payload: { status: "completed" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when not found", async () => {
    H.findApprenticeship.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/apprenticeships/${APR_ID}`, headers: auth(), payload: { status: "completed" } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

// ═══════════════════ POST /v1/hrms/apprenticeships/:id/stipends ═══════════════════
describe("POST /v1/hrms/apprenticeships/:id/stipends", () => {
  const payload = { month: "2026-05", workingDays: 26, daysPresent: 24 };

  it("submits a stipend run (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprenticeships/${APR_ID}/stipends`, headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("submitted");
    await drainF3();
    expect(H.insertStipend).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns 400 when daysPresent > workingDays", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprenticeships/${APR_ID}/stipends`, headers: auth(), payload: { month: "2026-05", workingDays: 20, daysPresent: 25 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("INVALID_ATTENDANCE");
    await app.close();
  });

  it("returns 400 for invalid month format", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprenticeships/${APR_ID}/stipends`, headers: auth(), payload: { month: "2026", workingDays: 26, daysPresent: 26 } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprenticeships/${APR_ID}/stipends`, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprenticeships/${APR_ID}/stipends`, headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when apprenticeship not found", async () => {
    H.findApprenticeship.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprenticeships/${APR_ID}/stipends`, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 409 when apprenticeship is not active", async () => {
    H.findApprenticeship.mockResolvedValue(appr({ status: "completed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprenticeships/${APR_ID}/stipends`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("APPRENTICESHIP_INACTIVE");
    await app.close();
  });

  it("returns 409 on duplicate stipend run (23505)", async () => {
    // The route now guards this with a synchronous pre-check
    // (repo.findStipendByMonth) rather than hoping to catch a 23505 out of
    // publishF3Write — publishF3Write is fire-and-forget, so the actual
    // insert (and any real unique-constraint violation) happens later, in
    // the async F3 consumer, well after this handler has already responded.
    // Mocking insertStipend to reject can no longer be observed by the
    // route at all; simulate the duplicate the way the route actually
    // detects it.
    H.findStipendByMonth.mockResolvedValue(stipend({ month: payload.month }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprenticeships/${APR_ID}/stipends`, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("DUPLICATE_STIPEND");
    await app.close();
  });
});

// ═══════════════════ GET /v1/hrms/apprenticeships/:id/stipends ═══════════════════
describe("GET /v1/hrms/apprenticeships/:id/stipends", () => {
  it("lists stipends by apprenticeship (200)", async () => {
    H.listStipendsByApprenticeship.mockResolvedValue([stipend()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apprenticeships/${APR_ID}/stipends`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apprenticeships/${APR_ID}/stipends` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// ═══════════════════ GET /v1/hrms/apprentice-stipends ═══════════════════
describe("GET /v1/hrms/apprentice-stipends", () => {
  it("lists stipends by status (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apprentice-stipends?status=submitted", headers: auth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apprentice-stipends" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apprentice-stipends", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ═══════════════════ GET /v1/hrms/apprentice-stipends/:stipendId ═══════════════════
describe("GET /v1/hrms/apprentice-stipends/:stipendId", () => {
  it("reads a stipend (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apprentice-stipends/${STP_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 404 when not found", async () => {
    H.findStipend.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apprentice-stipends/${STP_ID}`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns 400 for invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apprentice-stipends/bad-uuid", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

// ═══════════════════ POST /v1/hrms/apprentice-stipends/:stipendId/verify ═══════════════════
describe("POST /v1/hrms/apprentice-stipends/:stipendId/verify", () => {
  it("verifies a submitted stipend (200)", async () => {
    H.findStipend.mockResolvedValue(stipend({ status: "submitted", verifiedBy: null }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/verify`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("verified");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/verify`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/verify`, headers: auth(USER, ["employee"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when not found", async () => {
    H.findStipend.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/verify`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 409 when not in submitted state", async () => {
    H.findStipend.mockResolvedValue(stipend({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/verify`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });
});

// ═══════════════════ POST /v1/hrms/apprentice-stipends/:stipendId/approve ═══════════════════
describe("POST /v1/hrms/apprentice-stipends/:stipendId/approve", () => {
  it("approves a verified stipend and computes amounts (200)", async () => {
    H.findStipend.mockResolvedValue(stipend({ verifiedBy: USER }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/approve`, headers: auth(CHECKER), payload: {} });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.status).toBe("approved");
    expect(body.grossStipendMinor).toBe("500000");
    expect(body.napsReimbMinor).toBe("125000");
    expect(body.employerCostMinor).toBe("375000");
    await drainF3();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/approve`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/approve`, headers: auth(USER, ["employee"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 409 when not in verified state", async () => {
    H.findStipend.mockResolvedValue(stipend({ status: "submitted" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/approve`, headers: auth(CHECKER), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("returns 409 on SOD violation (same verifier and approver)", async () => {
    H.findStipend.mockResolvedValue(stipend({ verifiedBy: USER }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/approve`, headers: auth(USER), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });
});

// ═══════════════════ POST /v1/hrms/apprentice-stipends/:stipendId/reject ═══════════════════
describe("POST /v1/hrms/apprentice-stipends/:stipendId/reject", () => {
  it("rejects a submitted stipend (200)", async () => {
    H.findStipend.mockResolvedValue(stipend({ status: "submitted" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/reject`, headers: auth(), payload: { approverRemarks: "incorrect days" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("rejected");
    await app.close();
  });

  it("rejects a verified stipend (200)", async () => {
    H.findStipend.mockResolvedValue(stipend({ status: "verified" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/reject`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("rejected");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/reject`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/reject`, headers: auth(USER, ["employee"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 409 when already approved or paid", async () => {
    H.findStipend.mockResolvedValue(stipend({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/reject`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });
});

// ═══════════════════ POST /v1/hrms/apprentice-stipends/:stipendId/mark-paid ═══════════════════
describe("POST /v1/hrms/apprentice-stipends/:stipendId/mark-paid", () => {
  it("marks an approved stipend as paid (200)", async () => {
    H.findStipend.mockResolvedValue(stipend({ status: "approved", grossStipendMinor: 500_000n }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/mark-paid`, headers: auth(), payload: { paymentRef: "DBT-2026-001" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("paid");
    expect(r.json().paymentRef).toBe("DBT-2026-001");
    await drainF3();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns 400 for missing paymentRef", async () => {
    H.findStipend.mockResolvedValue(stipend({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/mark-paid`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/mark-paid`, payload: { paymentRef: "X" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/mark-paid`, headers: auth(USER, ["employee"]), payload: { paymentRef: "X" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when not found", async () => {
    H.findStipend.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/mark-paid`, headers: auth(), payload: { paymentRef: "X" } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 409 when not in approved state", async () => {
    H.findStipend.mockResolvedValue(stipend({ status: "verified" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP_ID}/mark-paid`, headers: auth(), payload: { paymentRef: "X" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });
});
