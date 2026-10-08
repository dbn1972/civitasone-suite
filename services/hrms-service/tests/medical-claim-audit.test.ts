/**
 * GAP2-HRMS-MEDICAL-01 / -02 acceptance.
 *
 * The medical create and approve/reject writes run as this module's disclosed
 * synchronous raw-SQL exception, so they get no in-transaction consumer audit;
 * the generic onResponse hook records only a coarse resourceType="medical",
 * action="update", resourceId=null row (the URL segment at index 3 is the
 * literal "claims", not a UUID). The fix publishes a PRECISE audit command
 * (fire-and-forget) from each handler after its write commits:
 *   - POST   → COMMANDS.medicalClaimCreate   (action "create")
 *   - PATCH approve → COMMANDS.medicalClaimApprove (action "approve")
 *   - PATCH reject  → COMMANDS.medicalClaimApprove (action "reject")
 * each carrying resourceType "medical_claim", the claim's OWN id as
 * resourceId, and the amount. These assertions FAIL on the old code (which
 * published neither topic from the routes).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP = "bbbbbbbb-0001-4000-8000-000000000001";
const CLAIM_ID = "cccccccc-0001-4000-8000-000000000001";
const HOSPITAL_ID = "dddddddd-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  sqlClientQuery: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const sqlClientFn = (...args: unknown[]) => H.sqlClientQuery(...args);
  sqlClientFn.end = async () => {};
  sqlClientFn.unsafe = async () => [];
  sqlClientFn.begin = async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => {
    const isAuditInsert = (text: unknown) =>
      typeof text === "string" && text.includes("audit.hr_action_log");
    const tx = ((...args: unknown[]) => {
      const [strings] = args as [TemplateStringsArray];
      if (strings?.[0]?.includes("set_config")) return Promise.resolve([]);
      return H.sqlClientQuery(...args);
    }) as typeof sqlClientFn;
    tx.unsafe = (...a: unknown[]) => (isAuditInsert(a[0]) ? Promise.resolve([]) : H.sqlClientQuery(...a));
    return fn(tx);
  };
  const mockTx = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => ({ rowCount: 1 }) }) }),
    insert: () => ({ values: async () => undefined }),
    execute: async () => [],
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: sqlClientFn,
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: { publish: (...a: unknown[]) => H.publish(...a) },
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

const claimRow = (over: Record<string, unknown> = {}) => ({
  id: CLAIM_ID, employee_id: EMP, claim_type: "outdoor",
  amount_minor: "50000", hospital_name: "AIIMS",
  hospital_id: HOSPITAL_ID, diagnosis: "Fever",
  documents: "[]", status: "pending",
  dependant_name: null, dependant_relation: null,
  approved_amount_minor: null, remarks: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

/** The audit publish for topic `t`, or undefined if the route never published it. */
function auditFor(topic: string): { type: string; payload: Record<string, unknown> } | undefined {
  const call = H.publish.mock.calls.find((c) => c[0] === topic);
  return call?.[1] as { type: string; payload: Record<string, unknown> } | undefined;
}

beforeEach(() => {
  vi.resetAllMocks();
  H.sqlClientQuery.mockReturnValue([]);
  H.publish.mockResolvedValue(undefined);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await (sqlClient as unknown as { end: () => Promise<void> }).end();
});

describe("GAP2-HRMS-MEDICAL-01 — POST publishes a precise create audit", () => {
  it("records resourceType medical_claim, the claim's own id, action create", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/medical/claims",
      headers: auth(),
      payload: {
        employeeId: EMP,
        claimType: "outdoor",
        amountMinor: 50000,
        hospitalName: "AIIMS Delhi",
        diagnosis: "Seasonal fever",
        documents: [],
      },
    });
    expect(r.statusCode).toBe(201);
    const claimId = r.json().data.id as string;

    const audit = auditFor(COMMANDS.medicalClaimCreate);
    expect(audit, "POST must publish a medicalClaimCreate audit").toBeDefined();
    expect(audit?.payload.resourceType).toBe("medical_claim");
    expect(audit?.payload.resourceId).toBe(claimId);
    expect(audit?.payload.action).toBe("create");
    expect(audit?.payload.amountMinor).toBe(50000);
    await app.close();
  });
});

describe("GAP2-HRMS-MEDICAL-01 — PATCH approve publishes a precise decision audit", () => {
  it("records resourceType medical_claim, the claim's own id, action approve, approved amount", async () => {
    H.sqlClientQuery.mockReturnValueOnce([claimRow({ status: "pending", amount_minor: "50000" })]);
    H.sqlClientQuery.mockReturnValueOnce([{ id: CLAIM_ID }]); // guarded UPDATE ... RETURNING id
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(),
      payload: { status: "approved", approvedAmountMinor: 45000 },
    });
    expect(r.statusCode).toBe(200);

    const audit = auditFor(COMMANDS.medicalClaimApprove);
    expect(audit, "PATCH approve must publish a medicalClaimApprove audit").toBeDefined();
    expect(audit?.payload.resourceType).toBe("medical_claim");
    expect(audit?.payload.resourceId).toBe(CLAIM_ID);
    expect(audit?.payload.action).toBe("approve");
    expect(audit?.payload.approvedAmountMinor).toBe(45000);
    await app.close();
  });

  it("records action reject (not a coarse 'update') on rejection", async () => {
    H.sqlClientQuery.mockReturnValueOnce([claimRow({ status: "pending", amount_minor: "50000" })]);
    H.sqlClientQuery.mockReturnValueOnce([{ id: CLAIM_ID }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/medical/claims/${CLAIM_ID}/approve`,
      headers: auth(),
      payload: { status: "rejected", remarks: "insufficient documents" },
    });
    expect(r.statusCode).toBe(200);

    const audit = auditFor(COMMANDS.medicalClaimApprove);
    expect(audit).toBeDefined();
    expect(audit?.payload.resourceId).toBe(CLAIM_ID);
    expect(audit?.payload.action).toBe("reject");
    expect(audit?.payload.approvedAmountMinor).toBe(0);
    await app.close();
  });
});
