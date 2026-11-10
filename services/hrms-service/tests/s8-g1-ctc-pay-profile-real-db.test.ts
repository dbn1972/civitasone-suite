/**
 * S8 G1 (HRMS side) real-DB, through the Fastify app and the in-memory queue, as the NOBYPASSRLS service role:
 * request a ctc_contract profile with CTC terms -> pending (no effect on pay) -> self-approval refused -> approved
 * by another user -> the payroll-input feed carries the approved terms. Flag S8_CTC_PROFILE_ENABLED.
 * Flag off (default): terms are refused and a terms-less ctc_contract request behaves exactly as before.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const { lockedThroughMock } = vi.hoisted(() => ({ lockedThroughMock: vi.fn() }));
vi.mock("../src/shared/payroll-client.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  fetchPayrollLockedThrough: (...a: unknown[]) => lockedThroughMock(...a),
}));

import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerPayProfileConsumers } from "../src/modules/pay-profile/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsPayProfiles } from "../src/modules/pay-profile/schema.js";

registerPayProfileConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const FLAG = "S8_CTC_PROFILE_ENABLED";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const deptId = randomUUID();
const desigId = randomUUID();
const LINEAGE = randomUUID();
const headers = (actor = MAKER, roles = ["hr_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles, sid: "s" }, SECRET)}`,
  "content-type": "application/json",
});
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(TENANT, () => db.transaction(fn));
let app: FastifyInstance;
let empId: string;
let emp2Id: string;

const terms = (o: Record<string, unknown> = {}) => ({
  annualFixedMinor: "96000000", templateLineageId: LINEAGE, epfWagePolicy: "ceiling", overrides: [{ code: "HRA", monthlyMinor: "2400000" }], ...o,
});
const post = (id: string, payload: Record<string, unknown>, actor = MAKER) =>
  app.inject({ method: "POST", url: `/v1/hrms/employees/${id}/pay-profile`, headers: headers(actor), payload });
async function seedEmployee(name: string, no: string): Promise<string> {
  const id = randomUUID();
  await asTenant(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: no, fullName: name, departmentId: deptId, designationId: desigId, dateOfJoining: "2024-04-01",
      status: "confirmed", employeeType: "contractual", basicMinor: 100n, createdBy: MAKER, updatedBy: MAKER,
    });
  });
  return id;
}

beforeAll(async () => {
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: `CT${TENANT.slice(0, 6)}`, name: "Digital Services", createdBy: MAKER, updatedBy: MAKER });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: `CD${TENANT.slice(0, 6)}`, name: "Project Associate", createdBy: MAKER, updatedBy: MAKER });
  });
  empId = await seedEmployee("Ananya Verma", "DIC-C-0917");
  emp2Id = await seedEmployee("Rohit Chandra", "DIC-C-1203");
});
beforeEach(() => { lockedThroughMock.mockReset(); lockedThroughMock.mockResolvedValue(null); delete process.env[FLAG]; });
afterAll(async () => {
  delete process.env[FLAG];
  await asTenant(async (tx) => {
    await tx.delete(hrmsPayProfiles).where(eq(hrmsPayProfiles.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

describe("flag off (default)", () => {
  it("refuses CTC terms with CTC_PROFILE_DISABLED and accepts a terms-less ctc_contract request exactly as before", async () => {
    const withTerms = await post(emp2Id, { payProfile: "ctc_contract", effectiveFrom: "2026-12-01", ctcTerms: terms() });
    expect(withTerms.statusCode).toBe(422);
    expect(withTerms.json().code).toBe("CTC_PROFILE_DISABLED");
    const bare = await post(emp2Id, { payProfile: "ctc_contract", effectiveFrom: "2026-12-01" });
    expect(bare.statusCode).toBe(202); // legacy behaviour kept (payroll refuses such a profile at run time)
    await drain();
    await asTenant((tx) => tx.delete(hrmsPayProfiles).where(and(eq(hrmsPayProfiles.tenantId, TENANT), eq(hrmsPayProfiles.employeeId, emp2Id))));
  });
});

describe("flag on: request -> pending -> maker-checker approval -> feed", () => {
  it("requires terms, validates them, then carries the approved terms to payroll", async () => {
    process.env[FLAG] = "true";
    const missing = await post(empId, { payProfile: "ctc_contract", effectiveFrom: "2026-12-01" });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe("CTC_TERMS_REQUIRED");
    const mid = await post(empId, { payProfile: "ctc_contract", effectiveFrom: "2026-12-10", ctcTerms: terms() });
    expect(mid.statusCode).toBe(400); // must be the 1st of a month
    const notCtc = await post(empId, { payProfile: "consolidated_contract", effectiveFrom: "2026-12-01", consolidatedMonthlyMinor: "3000000", ctcTerms: terms() });
    expect(notCtc.statusCode).toBe(422);
    expect(notCtc.json().code).toBe("CTC_TERMS_NOT_APPLICABLE");
    const badBody = await post(empId, { payProfile: "ctc_contract", effectiveFrom: "2026-12-01", ctcTerms: terms({ annualFixedMinor: "9.6 lakh" }) });
    expect(badBody.statusCode).toBe(400);
    const zero = await post(empId, { payProfile: "ctc_contract", effectiveFrom: "2026-12-01", ctcTerms: terms({ annualFixedMinor: "0" }) });
    expect(zero.statusCode).toBe(422);
    expect(zero.json().code).toBe("CTC_ANNUAL_INVALID");

    const ok = await post(empId, { payProfile: "ctc_contract", effectiveFrom: "2026-12-01", ctcTerms: terms(), orderRef: "DIC/HR/2026/117" });
    expect(ok.statusCode).toBe(202);
    await drain();
    const id = ok.json().id as string;
    const [pending] = await asTenant((tx) => tx.select().from(hrmsPayProfiles).where(eq(hrmsPayProfiles.id, id)));
    expect(pending).toMatchObject({ status: "pending", payProfile: "ctc_contract" });
    expect(pending!.ctcTerms).toMatchObject({ annualFixedMinor: "96000000", templateLineageId: LINEAGE, epfWagePolicy: "ceiling", esiOptOut: false, gratuityProvisionOn: true, overrides: [{ code: "HRA", monthlyMinor: "2400000" }] });

    // pending changes nothing: the feed still says govt_scale
    const feedBefore = await app.inject({ method: "GET", url: "/v1/hrms/internal/payroll-input?month=2026-12", headers: headers(MAKER, ["payroll_admin"]) });
    expect((feedBefore.json().employees as Array<{ id: string; payProfile: { profile: string } }>).find((e) => e.id === empId)!.payProfile.profile).toBe("govt_scale");

    const self = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${id}/approve`, headers: headers(MAKER), payload: {} });
    expect(self.statusCode).toBe(403);
    const approve = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${id}/approve`, headers: headers(CHECKER, ["payroll_admin"]), payload: { note: "CTC letter verified" } });
    expect(approve.statusCode).toBe(202);
    await drain();

    const feed = await app.inject({ method: "GET", url: "/v1/hrms/internal/payroll-input?month=2026-12", headers: headers(MAKER, ["payroll_admin"]) });
    const e = (feed.json().employees as Array<{ id: string; payProfile: Record<string, unknown> }>).find((x) => x.id === empId)!;
    expect(e.payProfile).toMatchObject({ profile: "ctc_contract", source: "assigned", effectiveFrom: "2026-12-01" });
    expect(e.payProfile.ctc).toMatchObject({ annualFixedMinor: "96000000", templateLineageId: LINEAGE, overrides: [{ code: "HRA", monthlyMinor: "2400000" }] });

    // the audit event carries the terms
    const audits = (await asTenant((tx) => tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${id} ORDER BY created_at`))) as unknown as Array<{ payload: { action: string; metadata: Record<string, unknown> } }>;
    expect(audits.map((a) => a.payload.action)).toEqual(["request", "approve"]);
    // privacy: the audit carries the annual figure, the template and the override CODES only, never override amounts
    for (const a of audits) expect(a.payload.metadata.ctcTerms).toEqual({ annualFixedMinor: "96000000", templateLineageId: LINEAGE, overrideCodes: ["HRA"] });

    // flag off again: the feed block is not emitted
    delete process.env[FLAG];
    const off = await app.inject({ method: "GET", url: "/v1/hrms/internal/payroll-input?month=2026-12", headers: headers(MAKER, ["payroll_admin"]) });
    expect((off.json().employees as Array<{ id: string; payProfile: Record<string, unknown> }>).find((x) => x.id === empId)!.payProfile.ctc).toBeUndefined();
  }, 60_000);

  it("the DB refuses CTC terms on a non-ctc profile row", async () => {
    await expect(asTenant((tx) => tx.insert(hrmsPayProfiles).values({
      tenantId: TENANT, employeeId: emp2Id, payProfile: "consolidated_contract", effectiveFrom: "2027-01-01", consolidatedMonthlyMinor: 3_000_000n,
      ctcTerms: { annualFixedMinor: "1", annualVariableTargetMinor: null, templateLineageId: LINEAGE, epfWagePolicy: "ceiling", esiOptOut: false, gratuityProvisionOn: true, overrides: [] },
      requestedBy: MAKER, createdBy: MAKER, updatedBy: MAKER,
    }))).rejects.toThrow();
  });
});
