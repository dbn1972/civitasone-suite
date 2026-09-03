/**
 * Apprentice stipend route wiring — enrol (boundary guard), submit a monthly
 * run, approval computing pro-rated stipend + NAPS reimbursement, two-person
 * control, and the Finance-AP outbox event.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000e1";
const MAKER = "aaaaaaaa-7777-4000-8000-00000000mk11";
const CHECKER = "aaaaaaaa-7777-4000-8000-00000000ck11";
const APPR_EMP = "a0a0a0a0-0000-4000-8000-0000000000a0";
const APR = "b0b0b0b0-0000-4000-8000-0000000000b0";
const STP = "c0c0c0c0-0000-4000-8000-0000000000c0";

const H = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
  findApprMock: vi.fn(),
  findStipendMock: vi.fn(),
  findStipendByMonthMock: vi.fn(),
  insertApprMock: vi.fn(),
  insertStipendMock: vi.fn(),
  updateStipendMock: vi.fn(),
  enqueueMock: vi.fn(),
  loadResolverMock: vi.fn(),
  empType: { type: "apprentice" },
}));

const stubTx = vi.hoisted(() => ({
  insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ messageId: "stub" }] }) }) }),
  // The enrol consumer reads the employee row inside its own write transaction
  // (for the NAPS-id fallback); serve it the same fixture scopedRead returns.
  select: () => ({ from: () => ({ where: () => ({ limit: async () => H.scopedReadMock() }) }) }),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  scopedRead: (...a: unknown[]) => H.scopedReadMock(...a),
  // The F3 consumer opens this transaction and calls markProcessed(tx, ...)
  // first, which needs insert().values().onConflictDoNothing().returning() to
  // resolve to a non-empty array (an empty one means "already processed" and
  // the consumer returns without writing). A bare `{}` tx silently swallowed
  // every consumer write.
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb(stubTx), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/apprentice-stipend/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertApprenticeship: (...a: unknown[]) => H.insertApprMock(...a),
  findApprenticeship: (...a: unknown[]) => H.findApprMock(...a),
  updateApprenticeship: async () => undefined,
  listApprenticeships: async () => [],
  insertStipend: (...a: unknown[]) => H.insertStipendMock(...a),
  findStipend: (...a: unknown[]) => H.findStipendMock(...a),
  // Without this override, findStipendByMonth (the route's synchronous
  // duplicate pre-check — see apprentice-stipend/routes.ts) falls through to
  // the REAL repo.js implementation via the `...(await io(...))` spread
  // above, which calls the globally-mocked `scopedRead` (see the db.js mock
  // above). That mock always resolves to the canned employee-type-check row
  // regardless of which query is actually asking, so the pre-check saw a
  // truthy "existing row" on the very first submission and always 409'd.
  findStipendByMonth: (...a: unknown[]) => H.findStipendByMonthMock(...a),
  updateStipend: (...a: unknown[]) => H.updateStipendMock(...a),
  listStipendsByApprenticeship: async () => [],
  listStipendsByStatus: async () => [],
}));
vi.mock("../src/shared/outbox.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));
vi.mock("../src/modules/employee/engagement-policy.js", async (io) => {
  const actual = await io<typeof import("../src/modules/employee/engagement-policy.js")>();
  return { ...actual, loadTypeResolver: (...a: unknown[]) => H.loadResolverMock(...a) };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildTypeResolver } from "../src/modules/employee/engagement-policy.js";
import { registerF3_apprentice_stipend_Consumers } from "../src/modules/apprentice-stipend/f3-consumer.js";

// These routes only PUBLISH; the row is written by the F3 consumer the worker
// runs. Without registering it the repo mocks below are never called at all, so
// the suite could not tell a working write from a crashing one.
registerF3_apprentice_stipend_Consumers(queue);

/** Await the in-memory queue's fan-out so the consumer's write has happened. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}

const CANON = [
  { category: "apprentice", eligibleForPayroll: false },
  { category: "pay_scale",  eligibleForPayroll: true },
];
const tok = (sub: string) => signToken({ sub, tid: TENANT, roles: ["hr_admin", "finance_officer"], sid: "s" }, SECRET);
const auth = (sub: string) => ({ authorization: `Bearer ${tok(sub)}` });

function appr(over: Record<string, unknown> = {}) {
  return { id: APR, tenantId: TENANT, apprenticeId: APPR_EMP, napsId: "NAPS-1", status: "active",
    monthlyStipendMinor: 500_000n, napsReimbPctBps: 2500, napsReimbCapMinor: 150_000n, version: 1, ...over };
}
function stipend(over: Record<string, unknown> = {}) {
  return { id: STP, tenantId: TENANT, apprenticeshipId: APR, month: "2026-05",
    workingDays: 26, daysPresent: 26, monthlyStipendMinor: 500_000n,
    napsReimbPctBps: 2500, napsReimbCapMinor: 150_000n,
    grossStipendMinor: 0n, napsReimbMinor: 0n, employerCostMinor: 0n,
    status: "verified", verifiedBy: MAKER, version: 1, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.scopedReadMock.mockImplementation(async () => [{ id: APPR_EMP, tenantId: TENANT, employeeType: H.empType.type, napsId: "NAPS-1" }]);
  H.loadResolverMock.mockResolvedValue(buildTypeResolver([], CANON));
  H.findApprMock.mockResolvedValue(appr());
  H.updateStipendMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.insertApprMock.mockResolvedValue(undefined);
  H.insertStipendMock.mockResolvedValue(undefined);
  H.findStipendByMonthMock.mockResolvedValue(null);
});

afterAll(async () => { await sqlClient.end(); });

describe("apprentice stipend routes", () => {
  it("enrols an apprentice (201)", async () => {
    H.empType.type = "apprentice";
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apprenticeships", headers: auth(MAKER),
      payload: { apprenticeId: APPR_EMP, qualification: "iti", monthlyStipendMinor: 500000, trainingStart: "2026-04-01" } });
    expect(r.statusCode).toBe(201);
    await drainF3();
    expect(H.insertApprMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects enrolment of a payroll-eligible (salaried) employee (409)", async () => {
    H.empType.type = "pay_scale";
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/apprenticeships", headers: auth(MAKER),
      payload: { apprenticeId: APPR_EMP, monthlyStipendMinor: 500000, trainingStart: "2026-04-01" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_AN_APPRENTICE");
    expect(H.insertApprMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("submits a monthly stipend run (201) — proves the RLS insert path", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprenticeships/${APR}/stipends`, headers: auth(MAKER),
      payload: { month: "2026-05", workingDays: 26, daysPresent: 26 } });
    expect(r.statusCode).toBe(201);
    await drainF3();
    expect(H.insertStipendMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("computes pro-rated stipend + NAPS reimbursement at approval and emits the event", async () => {
    // full attendance, ₹5,000 stipend, 25% reimb = ₹1,250 (< ₹1,500 cap)
    H.findStipendMock.mockResolvedValue(stipend());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP}/approve`, headers: auth(CHECKER), payload: {} });
    expect(r.statusCode).toBe(200);
    await drainF3();
    const b = r.json();
    expect(b.grossStipendMinor).toBe("500000");
    expect(b.napsReimbMinor).toBe("125000");
    expect(b.employerCostMinor).toBe("375000");
    const ev = H.enqueueMock.mock.calls[0][1];
    expect(ev.topic).toBe("hrms.apprentice_stipend.approved");
    expect(ev.payload.napsReimbMinor).toBe("125000");
    await app.close();
  });

  it("pro-rates for partial attendance (13/26 days)", async () => {
    H.findStipendMock.mockResolvedValue(stipend({ daysPresent: 13 }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP}/approve`, headers: auth(CHECKER), payload: {} });
    await drainF3();
    expect(r.json().grossStipendMinor).toBe("250000"); // half of 5,000
    await app.close();
  });

  it("enforces two-person control (409 SOD_VIOLATION)", async () => {
    H.findStipendMock.mockResolvedValue(stipend({ verifiedBy: CHECKER }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP}/approve`, headers: auth(CHECKER), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("marks an approved stipend paid and emits the paid event", async () => {
    H.findStipendMock.mockResolvedValue(stipend({ status: "approved", grossStipendMinor: 500_000n }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/apprentice-stipends/${STP}/mark-paid`, headers: auth(CHECKER), payload: { paymentRef: "DBT-1" } });
    expect(r.statusCode).toBe(200);
    await drainF3();
    expect(r.json().status).toBe("paid");
    expect(H.enqueueMock.mock.calls[0][1].topic).toBe("hrms.apprentice_stipend.paid");
    await app.close();
  });
});
