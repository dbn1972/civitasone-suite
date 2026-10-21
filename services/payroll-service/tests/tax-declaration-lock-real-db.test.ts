/**
 * GAP-PAYROLL-TAX-DECLARATION-05 -- a VERIFIED / APPROVED tax declaration is
 * read-only, enforced in the route (409 DECLARATION_LOCKED) AND in the consumer
 * (a command that bypasses the route, or was queued before the status changed,
 * cannot overwrite it). Real Postgres (migrated through 0159), buildApp() and
 * the real tax consumer on the memory queue; only the HRMS boundary is stubbed.
 *
 * Requires DATABASE_URL pointing at your own disposable Postgres (see
 * vitest.config.ts REL-035).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";

const EMPLOYEE = "72000000-4805-4000-8000-0000000000e1";
vi.mock("../src/shared/hrms-client.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  verifyEmployeeExists: vi.fn(async () => true),
  resolveActorEmployeeId: vi.fn(async () => EMPLOYEE),
  fetchEmployeeSummaries: vi.fn(async () => new Map()),
  fetchPayrollInput: vi.fn(async () => ({
    month: "2027-03",
    employees: [{ id: EMPLOYEE, employeeNo: "E1", fullName: "Test Employee", basicMinor: "1500000", pan: "ABCDE1234F", cityClass: "X", taxRegime: "new" }],
    lopDays: {}, overtimeHours: {},
  })),
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerTaxConsumers } from "../src/modules/tax/consumer.js";
import { submitDeclaration } from "../src/modules/tax/commands.js";
import { isDeclarationLocked, LOCKED_DECLARATION_STATUSES } from "../src/modules/tax/declaration-lock.js";

// Set by vitest.config.ts (env.JWT_SECRET); never a literal in the test.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ADMIN = randomUUID();
const EMP_LOGIN = randomUUID();
const FY = "2026-27";
const ADMIN_ROLES = ["payroll_admin"];
const EMPLOYEE_ROLES = ["employee"];

const auth = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "decl05" }, SECRET)}` });
type Row = Record<string, unknown>;
const q = (text: ReturnType<typeof sql>) =>
  withTenantScope(db as never, TENANT, async (tx: { execute: (x: unknown) => Promise<unknown> }) => Array.from((await tx.execute(text)) as Iterable<Row>));

let app: Awaited<ReturnType<typeof buildApp>>;
const drain = () => (queue as unknown as MemoryQueue).drain();

const declare = (roles: string[], sub: string, section80c: number, fy = FY) =>
  app.inject({
    method: "POST", url: "/v1/payroll/tax-declarations", headers: auth(sub, roles),
    payload: { fy, regime: "new", section80c, section80d: 0, otherDeductions: 0, rentPaidMinor: 0, employeeId: EMPLOYEE },
  });
const stored = async (fy = FY) =>
  (await q(sql`SELECT status, section_80c::text AS section80c FROM payroll.payroll_tax_declarations WHERE employee_id = ${EMPLOYEE}::uuid AND fy = ${fy}`))[0];
const setStatus = (status: string) =>
  q(sql`UPDATE payroll.payroll_tax_declarations SET status = ${status} WHERE employee_id = ${EMPLOYEE}::uuid AND fy = ${FY} RETURNING id`);
const submitAudits = () =>
  q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'tax_declaration' AND payload->>'action' = 'submit' ORDER BY created_at`);

beforeAll(async () => {
  const raw = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    raw(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerTaxConsumers(queue);
  app = await buildApp();
});

afterAll(async () => {
  await q(sql`DELETE FROM payroll.payroll_tax_declarations WHERE tenant_id = ${TENANT}::uuid`);
  await app?.close();
  await sqlClient.end();
});

describe("isDeclarationLocked", () => {
  it("locks exactly the verified and approved states", () => {
    expect([...LOCKED_DECLARATION_STATUSES]).toEqual(["verified", "approved"]);
    for (const s of ["verified", "approved"]) expect(isDeclarationLocked(s)).toBe(true);
    for (const s of ["draft", "submitted", "", null, undefined, "VERIFIED"]) expect(isDeclarationLocked(s as string | null | undefined)).toBe(false);
  });
});

describe("locked tax declaration (GAP-PAYROLL-TAX-DECLARATION-05)", () => {
  it("a submitted declaration can be resubmitted (control)", async () => {
    expect((await declare(EMPLOYEE_ROLES, EMP_LOGIN, 100000)).statusCode).toBe(202);
    await drain();
    expect(await stored()).toEqual({ status: "submitted", section80c: "100000" });
    expect((await declare(EMPLOYEE_ROLES, EMP_LOGIN, 150000)).statusCode).toBe(202);
    await drain();
    expect(await stored()).toEqual({ status: "submitted", section80c: "150000" });
  });

  it("VERIFIED: the route refuses the employee and payroll staff alike (409), nothing is queued, the stored amounts stay exact", async () => {
    await setStatus("verified");
    const auditsBefore = (await submitAudits()).length;
    for (const [roles, sub] of [[EMPLOYEE_ROLES, EMP_LOGIN], [ADMIN_ROLES, ADMIN]] as const) {
      const res = await declare(roles, sub, 900000);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("DECLARATION_LOCKED");
    }
    await drain();
    expect(await stored()).toEqual({ status: "verified", section80c: "150000" });
    expect((await submitAudits()).length).toBe(auditsBefore);
    // the GET the form reads still reports the locked state
    const get = await app.inject({ method: "GET", url: `/v1/payroll/tax-declarations?fy=${FY}&employeeId=${EMPLOYEE}`, headers: auth(ADMIN, ADMIN_ROLES) });
    expect(get.json()).toMatchObject({ status: "verified", section80c: 150000 });
  });

  it("VERIFIED: a command that bypasses the route (or was queued earlier) cannot overwrite it; the blocked write is audited as denied", async () => {
    const auditsBefore = (await submitAudits()).length;
    await submitDeclaration(
      { tenantId: TENANT, actorId: ADMIN, correlationId: randomUUID(), roles: ADMIN_ROLES } as never,
      { employeeId: EMPLOYEE, fy: FY, regime: "new", section80c: 777777, section80d: 0, otherDeductions: 0, rentPaidMinor: 0 },
    );
    await drain();
    expect(await stored()).toEqual({ status: "verified", section80c: "150000" });
    const audits = await submitAudits();
    expect(audits.length).toBe(auditsBefore + 1);
    expect(audits[audits.length - 1]!.payload).toMatchObject({ outcome: "denied", reason: "DECLARATION_LOCKED", employeeId: EMPLOYEE, fy: FY });
  });

  it("APPROVED is locked the same way", async () => {
    await setStatus("approved");
    const res = await declare(ADMIN_ROLES, ADMIN, 888888);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DECLARATION_LOCKED");
    await submitDeclaration(
      { tenantId: TENANT, actorId: ADMIN, correlationId: randomUUID(), roles: ADMIN_ROLES } as never,
      { employeeId: EMPLOYEE, fy: FY, regime: "new", section80c: 888888, section80d: 0, otherDeductions: 0, rentPaidMinor: 0 },
    );
    await drain();
    expect(await stored()).toEqual({ status: "approved", section80c: "150000" });
  });

  it("the lock is per declaration: another FY for the same employee is unaffected", async () => {
    expect((await declare(EMPLOYEE_ROLES, EMP_LOGIN, 50000, "2025-26")).statusCode).toBe(202);
    await drain();
    expect(await stored("2025-26")).toEqual({ status: "submitted", section80c: "50000" });
    expect(await stored()).toEqual({ status: "approved", section80c: "150000" });
  });

  it("once the status is back to submitted the declaration can be changed again (the consumer only guards locked rows)", async () => {
    await setStatus("submitted");
    expect((await declare(EMPLOYEE_ROLES, EMP_LOGIN, 250000)).statusCode).toBe(202);
    await drain();
    expect(await stored()).toEqual({ status: "submitted", section80c: "250000" });
  });
});
