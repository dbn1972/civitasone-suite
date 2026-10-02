/**
 * GAP-PAYROLL-FNF-01 -- F&F settlement submit / finance-approve / disburse /
 * reject workflow, end to end against a REAL Postgres (migrated through
 * 0052), through buildApp() and the real fnf consumer.
 *
 * The consumer is subscribed on the app's own (memory-driver) queue, wrapped
 * in runWithTenant exactly as worker.ts does, so a route's 202 is followed
 * by the real async write + audit outbox row, under FORCE RLS.
 *
 * Requires DATABASE_URL pointing at a disposable, migrated instance (see
 * vitest.config.ts REL-035).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/hrms-client.js")>()),
  fetchEmployeeSummaries: vi.fn(async () => new Map()),
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerFnfConsumers } from "../src/modules/fnf/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();

// Distinct people (JWT subjects).
const COMPUTER = randomUUID();   // computed the settlement
const MAKER = randomUUID();      // payroll officer who submits
const CHECKER = randomUUID();    // finance officer who approves
const CHECKER_2 = randomUUID();  // a second finance officer (race)
const PAYER = randomUUID();      // payroll admin who disburses
const ADMIN_APPROVER = randomUUID(); // payroll admin used as approver

type Roles = string[];
function auth(sub: string, roles: Roles, tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "fnf-wf" }, SECRET)}` };
}

let app: Awaited<ReturnType<typeof buildApp>>;
/** Audit events the ROUTE publishes straight to the queue (denied attempts). */
const deniedAudits: Array<{ actorId: string; payload: Record<string, unknown> }> = [];

async function post(id: string, action: string, sub: string, roles: Roles, payload: Record<string, unknown>, tenant = TENANT) {
  return app.inject({
    method: "POST",
    url: `/v1/payroll/fnf/settlements/${id}/${action}`,
    headers: auth(sub, roles, tenant),
    payload,
  });
}

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);

async function read(id: string, tenant = TENANT): Promise<Row | undefined> {
  return withTenantScope(db as never, tenant, async (tx: { execute: (q: unknown) => Promise<unknown> }) =>
    rowsOf(await tx.execute(sql`
      SELECT status, version, submitted_by, finance_approved_by, disbursed_by,
             payment_reference, payment_date::text AS payment_date,
             rejected_by, rejection_reason, computed_by, net_payable_minor::text AS net_payable_minor
        FROM payroll.fnf_settlements WHERE id = ${id}::uuid
    `))[0]);
}

async function audits(id: string): Promise<Row[]> {
  return withTenantScope(db as never, TENANT, async (tx: { execute: (q: unknown) => Promise<unknown> }) =>
    rowsOf(await tx.execute(sql`
      SELECT actor_id, payload FROM _outbox.messages
       WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${id}
       ORDER BY created_at
    `)));
}

/** Poll until `pred` holds (the consumer runs after the route's 202). */
async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    v = await fn();
  }
  return v;
}
const settle = () => new Promise((r) => setTimeout(r, 300));

async function seed(status: string, opts: { createdBy?: string; computedBy?: string | null; submittedBy?: string | null; financeApprovedBy?: string | null; version?: number; employeeId?: string; separationDate?: string } = {}): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.fnf_settlements
        (id, tenant_id, employee_id, separation_type, separation_date, gratuity_gross_minor,
         net_payable_minor, status, created_by, updated_by, computed_by, submitted_by,
         finance_approved_by, version, payment_reference, payment_date, disbursed_by)
      VALUES (${id}::uuid, ${TENANT}::uuid, ${opts.employeeId ?? randomUUID()}::uuid, 'retirement',
        ${opts.separationDate ?? "2026-06-30"}::date, 1000000, 1000000, ${status},
        ${opts.createdBy ?? COMPUTER}::uuid, ${opts.createdBy ?? COMPUTER}::uuid,
        ${opts.computedBy === undefined ? COMPUTER : opts.computedBy}::uuid,
        ${opts.submittedBy ?? null}::uuid, ${opts.financeApprovedBy ?? null}::uuid, ${opts.version ?? 1},
        ${status === "disbursed" ? "X1234" : null}, ${status === "disbursed" ? "2026-09-01" : null}::date,
        ${status === "disbursed" ? PAYER : null}::uuid)
    `);
  }));
  return id;
}

const PAYROLL_OFFICER: Roles = ["payroll_officer"];
const PAYROLL_ADMIN: Roles = ["payroll_admin"];
const FINANCE: Roles = ["finance_officer"];
const SUPER: Roles = ["super_admin"];
const HR_ADMIN: Roles = ["hr_admin"];
const DISBURSE_BODY = (version: number) => ({ version, paymentReference: "SBIN-UTR-2026100200001", paymentDate: "2026-09-30" });

beforeAll(async () => {
  // Mirror worker.ts: every consumer runs inside runWithTenant(msg.tenantId).
  const q = queue as unknown as { subscribe: (t: string, h: (m: { tenantId: string }) => Promise<void>) => void; start?: () => Promise<void> };
  const raw = q.subscribe.bind(q);
  registerFnfConsumers({
    ...queue,
    subscribe: (topic: string, handler: (m: { tenantId: string }) => Promise<void>) =>
      raw(topic, (m) => runWithTenant(m.tenantId, () => handler(m))),
  } as unknown as Parameters<typeof registerFnfConsumers>[0]);
  raw("audit.event.record", async (m) => {
    const e = m as unknown as { actorId: string; payload: Record<string, unknown> };
    if (e.payload.outcome === "denied") deniedAudits.push({ actorId: e.actorId, payload: e.payload });
  });
  await q.start?.();
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await sqlClient.end();
});

describe("F&F workflow -- happy path, every transition audited", () => {
  it("computed -> submitted -> finance_approved -> disbursed, with actor/reason/before-after on each audit row", async () => {
    const id = await seed("computed");

    expect((await post(id, "submit", MAKER, PAYROLL_OFFICER, { version: 1, note: "all documents verified" })).statusCode).toBe(202);
    let row = await until(() => read(id), (r) => r?.status === "submitted");
    expect(row).toMatchObject({ status: "submitted", version: 2, submitted_by: MAKER });

    expect((await post(id, "finance-approve", CHECKER, FINANCE, { version: 2 })).statusCode).toBe(202);
    row = await until(() => read(id), (r) => r?.status === "finance_approved");
    expect(row).toMatchObject({ status: "finance_approved", version: 3, finance_approved_by: CHECKER });

    const res = await post(id, "disburse", PAYER, PAYROLL_ADMIN, DISBURSE_BODY(3));
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toMatchObject({ id, requestedStatus: "disbursed" });
    row = await until(() => read(id), (r) => r?.status === "disbursed");
    expect(row).toMatchObject({
      status: "disbursed", version: 4, disbursed_by: PAYER,
      payment_reference: "SBIN-UTR-2026100200001", payment_date: "2026-09-30",
    });

    const trail = await audits(id);
    expect(trail.map((a) => [a.actor_id, (a.payload as Row).action])).toEqual([
      [MAKER, "fnf_submit"], [CHECKER, "fnf_finance_approve"], [PAYER, "fnf_disburse"],
    ]);
    expect(trail[0]!.payload).toMatchObject({
      resourceType: "fnf_settlement", note: "all documents verified",
      oldValue: { status: "computed", version: 1 }, newValue: { status: "submitted", version: 2 },
    });
    expect(trail[2]!.payload).toMatchObject({
      oldValue: { status: "finance_approved", version: 3 },
      newValue: { status: "disbursed", version: 4, paymentReference: "SBIN-UTR-2026100200001", paymentDate: "2026-09-30", netPayableMinor: "1000000" },
    });
  });

  it("a legacy 'draft' row (written before this workflow) is submittable", async () => {
    const id = await seed("draft");
    expect((await post(id, "submit", MAKER, PAYROLL_ADMIN, { version: 1 })).statusCode).toBe(202);
    expect(await until(() => read(id), (r) => r?.status === "submitted")).toMatchObject({ status: "submitted" });
  });

  it("super_admin can disburse", async () => {
    const id = await seed("finance_approved", { submittedBy: MAKER, financeApprovedBy: CHECKER, version: 3 });
    expect((await post(id, "disburse", PAYER, SUPER, DISBURSE_BODY(3))).statusCode).toBe(202);
    expect(await until(() => read(id), (r) => r?.status === "disbursed")).toMatchObject({ disbursed_by: PAYER });
  });
});

describe("F&F workflow -- illegal transitions are 409 and change nothing", () => {
  const cases: Array<[string, string, string, Roles, Record<string, unknown>]> = [
    ["computed", "finance-approve", CHECKER, FINANCE, { version: 1 }],
    ["computed", "disburse", PAYER, PAYROLL_ADMIN, DISBURSE_BODY(1)],
    ["computed", "reject", CHECKER, FINANCE, { version: 1, reason: "numbers look wrong to me" }],
    ["submitted", "submit", MAKER, PAYROLL_OFFICER, { version: 1 }],
    ["submitted", "disburse", PAYER, PAYROLL_ADMIN, DISBURSE_BODY(1)],
    ["finance_approved", "finance-approve", CHECKER_2, FINANCE, { version: 1 }],
    ["disbursed", "reject", PAYER, PAYROLL_ADMIN, { version: 1, reason: "paid twice by mistake" }],
    ["disbursed", "disburse", PAYER, PAYROLL_ADMIN, DISBURSE_BODY(1)],
    ["rejected", "submit", MAKER, PAYROLL_OFFICER, { version: 1 }],
    ["rejected", "finance-approve", CHECKER, FINANCE, { version: 1 }],
  ];
  for (const [status, action, sub, roles, body] of cases) {
    it(`${action} on a ${status} settlement -> 409 FNF_INVALID_TRANSITION`, async () => {
      const id = await seed(status, {
        submittedBy: MAKER,
        financeApprovedBy: status === "finance_approved" || status === "disbursed" ? CHECKER : null,
      });
      const res = await post(id, action, sub, roles, body);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("FNF_INVALID_TRANSITION");
      await settle();
      expect((await read(id))?.status).toBe(status);
      expect(await audits(id)).toHaveLength(0);
    });
  }

  it("a stale version -> 409 FNF_VERSION_CONFLICT", async () => {
    const id = await seed("computed", { version: 4 });
    const res = await post(id, "submit", MAKER, PAYROLL_OFFICER, { version: 3 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("FNF_VERSION_CONFLICT");
  });
});

describe("F&F workflow -- maker-checker 403s", () => {
  const forbiddenRole: Array<[string, string, Roles, (v: number) => Record<string, unknown>]> = [
    ["computed", "submit", HR_ADMIN, (v) => ({ version: v })],
    ["computed", "submit", FINANCE, (v) => ({ version: v })],
    ["computed", "submit", SUPER, (v) => ({ version: v })],
    ["submitted", "finance-approve", PAYROLL_OFFICER, (v) => ({ version: v })],
    ["submitted", "finance-approve", SUPER, (v) => ({ version: v })],
    ["finance_approved", "disburse", FINANCE, DISBURSE_BODY],
    ["finance_approved", "disburse", PAYROLL_OFFICER, DISBURSE_BODY],
    ["submitted", "reject", PAYROLL_OFFICER, (v) => ({ version: v, reason: "not my call to make" })],
    // From finance_approved, rejecting replaces the disburse step: finance_officer can't.
    ["finance_approved", "reject", FINANCE, (v) => ({ version: v, reason: "changed my mind after approving" })],
  ];
  for (const [status, action, roles, body] of forbiddenRole) {
    it(`${roles.join("+")} cannot ${action} a ${status} settlement -> 403`, async () => {
      const id = await seed(status, { submittedBy: MAKER, financeApprovedBy: status === "finance_approved" ? CHECKER : null });
      const res = await post(id, action, randomUUID(), roles, body(1));
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
      await settle();
      expect((await read(id))?.status).toBe(status);
    });
  }

  const sod: Array<[string, string, string, Roles, Record<string, unknown>, string]> = [
    ["submitted", "finance-approve", MAKER, PAYROLL_ADMIN, { version: 1 }, "FNF_SELF_APPROVAL_FORBIDDEN"],
    ["submitted", "finance-approve", COMPUTER, PAYROLL_ADMIN, { version: 1 }, "FNF_SELF_APPROVAL_FORBIDDEN"],
    ["submitted", "reject", MAKER, PAYROLL_ADMIN, { version: 1, reason: "withdrawing my own submission" }, "FNF_SELF_APPROVAL_FORBIDDEN"],
    ["finance_approved", "disburse", CHECKER, PAYROLL_ADMIN, DISBURSE_BODY(1), "FNF_SELF_DISBURSAL_FORBIDDEN"],
    ["finance_approved", "reject", CHECKER, PAYROLL_ADMIN, { version: 1, reason: "vetoing my own approval" }, "FNF_SELF_DISBURSAL_FORBIDDEN"],
    // Three distinct people for a money release: neither the submitter nor
    // the computer may disburse (or veto at that stage) either.
    ["finance_approved", "disburse", MAKER, PAYROLL_ADMIN, DISBURSE_BODY(1), "FNF_SELF_DISBURSAL_FORBIDDEN"],
    ["finance_approved", "disburse", COMPUTER, SUPER, DISBURSE_BODY(1), "FNF_SELF_DISBURSAL_FORBIDDEN"],
    ["finance_approved", "reject", MAKER, PAYROLL_ADMIN, { version: 1, reason: "pulling back what I submitted" }, "FNF_SELF_DISBURSAL_FORBIDDEN"],
  ];
  for (const [status, action, sub, roles, body, code] of sod) {
    it(`${action} on ${status} by ${sub === MAKER ? "the submitter" : sub === COMPUTER ? "the computer" : "the approver"} -> 403 ${code}, audited as denied`, async () => {
      const id = await seed(status, { submittedBy: MAKER, financeApprovedBy: status === "finance_approved" ? CHECKER : null });
      const res = await post(id, action, sub, roles, body);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe(code);
      await settle();
      expect((await read(id))?.status).toBe(status);
      expect(deniedAudits.filter((a) => a.payload.resourceId === id)).toEqual([
        expect.objectContaining({ actorId: sub, payload: expect.objectContaining({ outcome: "denied", denialCode: code, resourceType: "fnf_settlement" }) }),
      ]);
    });
  }

  it("a legacy row without computed_by uses created_by as the computer", async () => {
    const id = await seed("submitted", { createdBy: COMPUTER, computedBy: null, submittedBy: MAKER });
    const res = await post(id, "finance-approve", COMPUTER, PAYROLL_ADMIN, { version: 1 });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FNF_SELF_APPROVAL_FORBIDDEN");
  });

  it.each([["submitter", MAKER], ["computer", COMPUTER], ["approver", CHECKER]])(
    "the consumer re-asserts the disburse rule: a disburse command from the %s (bypassing the route) is a no-op",
    async (_who, actorId) => {
      const id = await seed("finance_approved", { submittedBy: MAKER, financeApprovedBy: CHECKER, version: 3 });
      await runWithTenant(TENANT, () => queue.publish(COMMANDS.fnfTransition, {
        messageId: randomUUID(), type: COMMANDS.fnfTransition, tenantId: TENANT, actorId,
        correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { id, tenantId: TENANT, action: "disburse", expectedVersion: 3, paymentReference: "UTR-BYPASS-1", paymentDate: "2026-09-30" },
      }));
      await settle();
      expect(await read(id)).toMatchObject({ status: "finance_approved", version: 3, payment_reference: null });
      expect(await audits(id)).toHaveLength(0);
    },
  );

  it("a 409 is not audited as a denied attempt (only segregation-of-duties denials are)", async () => {
    const id = await seed("computed");
    expect((await post(id, "finance-approve", CHECKER, FINANCE, { version: 1 })).statusCode).toBe(409);
    await settle();
    expect(deniedAudits.filter((a) => a.payload.resourceId === id)).toHaveLength(0);
  });

  it("the consumer re-asserts segregation of duties: a command from the submitter (bypassing the route) is a no-op", async () => {
    const id = await seed("submitted", { submittedBy: MAKER, version: 2 });
    await runWithTenant(TENANT, () => queue.publish(COMMANDS.fnfTransition, {
      messageId: randomUUID(), type: COMMANDS.fnfTransition, tenantId: TENANT, actorId: MAKER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, action: "finance-approve", expectedVersion: 2 },
    }));
    await settle();
    expect(await read(id)).toMatchObject({ status: "submitted", version: 2, finance_approved_by: null });
    expect(await audits(id)).toHaveLength(0);
  });
});

describe("F&F workflow -- input validation (400)", () => {
  it("reject needs a reason of at least 10 characters", async () => {
    const id = await seed("submitted", { submittedBy: MAKER });
    expect((await post(id, "reject", CHECKER, FINANCE, { version: 1 })).statusCode).toBe(400);
    expect((await post(id, "reject", CHECKER, FINANCE, { version: 1, reason: "   too short   " })).statusCode).toBe(400);
  });

  it("disburse needs a well-formed payment reference and a real, non-future payment date", async () => {
    const id = await seed("finance_approved", { submittedBy: MAKER, financeApprovedBy: CHECKER });
    for (const bad of [
      { version: 1, paymentDate: "2026-09-30" },
      { version: 1, paymentReference: "ab", paymentDate: "2026-09-30" },
      { version: 1, paymentReference: "UTR 123; DROP", paymentDate: "2026-09-30" },
      { version: 1, paymentReference: "UTR123456" },
      { version: 1, paymentReference: "UTR123456", paymentDate: "2026-02-30" },
      { version: 1, paymentReference: "UTR123456", paymentDate: "2999-01-01" },
    ]) {
      expect((await post(id, "disburse", PAYER, PAYROLL_ADMIN, bad)).statusCode).toBe(400);
    }
    expect((await read(id))?.status).toBe("finance_approved");
  });

  it("version is required", async () => {
    const id = await seed("computed");
    expect((await post(id, "submit", MAKER, PAYROLL_OFFICER, {})).statusCode).toBe(400);
  });
});

describe("F&F workflow -- races and double-clicks", () => {
  it("two different finance officers approve at once: exactly one wins, one audit row", async () => {
    const id = await seed("submitted", { submittedBy: MAKER, version: 2 });
    const cmd = (actorId: string) => runWithTenant(TENANT, () => queue.publish(COMMANDS.fnfTransition, {
      messageId: randomUUID(), type: COMMANDS.fnfTransition, tenantId: TENANT, actorId,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, action: "finance-approve", expectedVersion: 2 },
    }));
    await Promise.all([cmd(CHECKER), cmd(CHECKER_2)]);
    const row = await until(() => read(id), (r) => r?.status === "finance_approved");
    await settle();
    expect(row).toMatchObject({ status: "finance_approved", version: 3 });
    expect([CHECKER, CHECKER_2]).toContain(row!.finance_approved_by);
    const trail = await audits(id);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.actor_id).toBe(row!.finance_approved_by);
  });

  it("approve and reject racing on the same version: exactly one transition", async () => {
    const id = await seed("submitted", { submittedBy: MAKER, version: 2 });
    const [a, b] = await Promise.all([
      post(id, "finance-approve", CHECKER, FINANCE, { version: 2 }),
      post(id, "reject", CHECKER_2, FINANCE, { version: 2, reason: "gratuity years look wrong" }),
    ]);
    expect([a.statusCode, b.statusCode].every((c) => c === 202 || c === 409)).toBe(true);
    const row = await until(() => read(id), (r) => r?.status !== "submitted");
    await settle();
    expect(["finance_approved", "rejected"]).toContain(row!.status);
    expect(row!.version).toBe(3);
    expect(await audits(id)).toHaveLength(1);
  });

  it("a double-clicked submit transitions once", async () => {
    const id = await seed("computed");
    const results = await Promise.all([
      post(id, "submit", MAKER, PAYROLL_OFFICER, { version: 1 }),
      post(id, "submit", MAKER, PAYROLL_OFFICER, { version: 1 }),
    ]);
    expect(results.some((r) => r.statusCode === 202)).toBe(true);
    await until(() => read(id), (r) => r?.status === "submitted");
    await settle();
    expect(await read(id)).toMatchObject({ status: "submitted", version: 2 });
    expect(await audits(id)).toHaveLength(1);
  });

  it("disburse cannot be recorded twice (no double-pay): the second attempt is 409", async () => {
    const id = await seed("finance_approved", { submittedBy: MAKER, financeApprovedBy: CHECKER, version: 3 });
    expect((await post(id, "disburse", PAYER, PAYROLL_ADMIN, DISBURSE_BODY(3))).statusCode).toBe(202);
    await until(() => read(id), (r) => r?.status === "disbursed");
    const again = await post(id, "disburse", PAYER, PAYROLL_ADMIN, { ...DISBURSE_BODY(4), paymentReference: "OTHER-UTR-9999" });
    expect(again.statusCode).toBe(409);
    await settle();
    expect(await read(id)).toMatchObject({ payment_reference: "SBIN-UTR-2026100200001", version: 4 });
    expect((await audits(id)).filter((a) => (a.payload as Row).action === "fnf_disburse")).toHaveLength(1);
  });

  it("the DB refuses a disbursed row without payment details", async () => {
    const id = await seed("finance_approved", { submittedBy: MAKER, financeApprovedBy: CHECKER });
    await expect(runWithTenant(TENANT, () => db.transaction((tx) => tx.execute(sql`
      UPDATE payroll.fnf_settlements SET status = 'disbursed' WHERE id = ${id}::uuid`)))).rejects.toThrow();
  });
});

describe("F&F workflow -- reject sends it back for recompute", () => {
  it("reject records reason + actor; recompute reopens it as 'computed' and the chain restarts", async () => {
    const employeeId = randomUUID();
    const id = await seed("submitted", { submittedBy: MAKER, version: 2, employeeId, separationDate: "2026-05-31" });

    expect((await post(id, "reject", CHECKER, FINANCE, { version: 2, reason: "leave balance is from the wrong year" })).statusCode).toBe(202);
    expect(await until(() => read(id), (r) => r?.status === "rejected")).toMatchObject({
      status: "rejected", version: 3, rejected_by: CHECKER, rejection_reason: "leave balance is from the wrong year",
    });

    await runWithTenant(TENANT, () => queue.publish(COMMANDS.fnfCompute, {
      messageId: randomUUID(), type: COMMANDS.fnfCompute, tenantId: TENANT, actorId: MAKER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        employeeId, tenantId: TENANT, separationDate: "2026-05-31", separationType: "retirement",
        employeeCategory: "non_govt_covered", noticeBuyoutMinor: "0", leaveEncashmentGrossMinor: "0",
        gratuityGrossMinor: "2000000", retrenchmentCompMinor: "0", vrsCompMinor: "0", arrearsMinor: "0",
        lastDrawnWagesMinor: "5000000", completedYears: 10, avgSalaryLast10MonthsMinor: "5000000",
        leaveBalanceDays: 0, priorLeaveEncashExemptionMinor: "0", remainingMonthsToRetirement: 0,
        taxRegime: "new", salaryYtdMinor: "0", tdsYtdMinor: "0", deductions80cMinor: "0",
        deductions80dMinor: "0", otherDeductionsMinor: "0", fyStartYear: 2026,
      },
    }));
    const row = await until(() => read(id), (r) => r?.status === "computed");
    expect(row).toMatchObject({ status: "computed", version: 4, computed_by: MAKER, submitted_by: null, rejected_by: null, rejection_reason: null });
    expect(row!.net_payable_minor).not.toBe("1000000");
    const trail = await audits(id);
    expect(trail.map((a) => (a.payload as Row).action)).toEqual(["fnf_reject", "fnf_recompute"]);
    expect(trail[0]!.payload).toMatchObject({ reason: "leave balance is from the wrong year", oldValue: { status: "submitted" }, newValue: { status: "rejected" } });

    // MAKER recomputed it, so MAKER can submit but can no longer finance-approve it.
    expect((await post(id, "submit", PAYER, PAYROLL_ADMIN, { version: 4 })).statusCode).toBe(202);
    await until(() => read(id), (r) => r?.status === "submitted");
    const self = await post(id, "finance-approve", MAKER, PAYROLL_ADMIN, { version: 5 });
    expect(self.statusCode).toBe(403);
    expect((await post(id, "finance-approve", ADMIN_APPROVER, PAYROLL_ADMIN, { version: 5 })).statusCode).toBe(202);
  });

  it("recompute does NOT touch a settlement that is not rejected", async () => {
    const employeeId = randomUUID();
    const id = await seed("submitted", { submittedBy: MAKER, version: 2, employeeId, separationDate: "2026-04-30" });
    await runWithTenant(TENANT, () => queue.publish(COMMANDS.fnfCompute, {
      messageId: randomUUID(), type: COMMANDS.fnfCompute, tenantId: TENANT, actorId: MAKER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        employeeId, tenantId: TENANT, separationDate: "2026-04-30", separationType: "retirement",
        employeeCategory: "non_govt_covered", gratuityGrossMinor: "9000000", lastDrawnWagesMinor: "5000000",
        completedYears: 10, avgSalaryLast10MonthsMinor: "5000000", leaveBalanceDays: 0,
        taxRegime: "new", salaryYtdMinor: "0", tdsYtdMinor: "0", fyStartYear: 2026,
      },
    }));
    await settle();
    expect(await read(id)).toMatchObject({ status: "submitted", version: 2, net_payable_minor: "1000000" });
  });
});

describe("F&F workflow -- tenant isolation", () => {
  it("another tenant's officer cannot see or move the settlement (404, unchanged)", async () => {
    const id = await seed("computed");
    const res = await post(id, "submit", MAKER, PAYROLL_OFFICER, { version: 1 }, OTHER_TENANT);
    expect(res.statusCode).toBe(404);
    await settle();
    expect((await read(id))?.status).toBe("computed");
    expect(await read(id, OTHER_TENANT)).toBeUndefined();
  });

  it("a command carrying another tenant id cannot move this tenant's row", async () => {
    const id = await seed("computed");
    await runWithTenant(OTHER_TENANT, () => queue.publish(COMMANDS.fnfTransition, {
      messageId: randomUUID(), type: COMMANDS.fnfTransition, tenantId: OTHER_TENANT, actorId: MAKER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: OTHER_TENANT, action: "submit", expectedVersion: 1 },
    }));
    await settle();
    expect((await read(id))?.status).toBe("computed");
  });
});

describe("F&F list/detail -- payroll_officer can read (needed to submit)", () => {
  it("GET list returns the workflow trail fields", async () => {
    const id = await seed("submitted", { submittedBy: MAKER, version: 2 });
    const res = await app.inject({ method: "GET", url: `/v1/payroll/fnf/settlements/${id}`, headers: auth(MAKER, PAYROLL_OFFICER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id, status: "submitted", version: 2, submittedBy: MAKER, computedBy: COMPUTER });
  });

  it("compute stays closed to payroll_officer", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/payroll/fnf/compute", headers: auth(MAKER, PAYROLL_OFFICER), payload: {} });
    expect(res.statusCode).toBe(403);
  });
});
