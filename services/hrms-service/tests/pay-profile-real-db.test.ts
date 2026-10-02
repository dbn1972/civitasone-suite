/**
 * PAY-PROFILES (PR1) -- real-DB, end to end through the Fastify app and the
 * in-memory queue:
 *
 *  - migrations 0166/0167: CHECKs + partial unique indexes actually hold;
 *  - deputed-IN deputation with pay terms (no posting switch, no internal
 *    parent department), and PATCH .../pay-terms;
 *  - maker-checker pay-profile flow: request -> pending (no effect on pay) ->
 *    self-approval refused -> approval by another user -> active, previous
 *    open profile closed the day before;
 *  - the internal payroll-input feed carries payProfile / engagement /
 *    advisories, defaults to govt_scale, and leaves existing fields intact;
 *  - lock check against payroll fails closed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
import { PayrollUnavailableError } from "../src/shared/payroll-client.js";
import { registerPayProfileConsumers } from "../src/modules/pay-profile/consumer.js";
import { registerDeputationConsumers } from "../src/modules/deputation/consumer.js";
import { registerF3_deputation_Consumers } from "../src/modules/deputation/f3-consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsServiceBookEntries } from "../src/modules/service-book/schema.js";
import { hrmsDeputations } from "../src/modules/deputation/schema.js";
import { hrmsPayProfiles } from "../src/modules/pay-profile/schema.js";
import { COMMANDS } from "../src/topics.js";
import { payProfileAtDateTx } from "../src/modules/pay-profile/repo.js";
import { sql } from "drizzle-orm";

/** Audit events this suite's actions enqueued (outbox), newest last. */
async function audits(resourceType: string, resourceId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await asTenant((tx) => tx.execute(sql`
    SELECT payload FROM _outbox.messages
    WHERE topic = 'audit.event.record' AND payload->>'resourceType' = ${resourceType} AND payload->>'resourceId' = ${resourceId}
    ORDER BY created_at`)) as unknown as Array<{ payload: Record<string, unknown> }>;
  return rows.map((r) => r.payload);
}

registerPayProfileConsumers(queue);
registerDeputationConsumers(queue);
registerF3_deputation_Consumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const deptId = randomUUID();
const desigId = randomUUID();

const headers = (actor = MAKER, roles = ["hr_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles, sid: "s" }, SECRET)}`,
  "content-type": "application/json",
});

let app: FastifyInstance;
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

async function seedEmployee(name: string, employeeType: string, basicMinor = 5_000_000n): Promise<string> {
  const id = randomUUID();
  await asTenant(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `PP-${id.slice(0, 8)}`, fullName: name,
      departmentId: deptId, designationId: desigId, dateOfJoining: "2024-01-01",
      status: "confirmed", employeeType, basicMinor, createdBy: MAKER, updatedBy: MAKER,
    });
  });
  return id;
}

interface FeedEmp {
  id: string;
  payProfile: { profile: string; deputation?: Record<string, unknown> } & Record<string, unknown>;
  engagement: Record<string, unknown>;
  advisories: string[];
  [k: string]: unknown;
}

async function feed(month: string): Promise<FeedEmp[]> {
  const r = await app.inject({ method: "GET", url: `/v1/hrms/internal/payroll-input?month=${month}`, headers: headers(MAKER, ["payroll_admin"]) });
  expect(r.statusCode).toBe(200);
  return (r.json() as { employees: FeedEmp[] }).employees;
}
const feedFor = async (month: string, id: string) => (await feed(month)).find((e) => e.id === id)!;

async function profilesOf(employeeId: string) {
  return asTenant((tx) => tx.select().from(hrmsPayProfiles)
    .where(and(eq(hrmsPayProfiles.tenantId, TENANT), eq(hrmsPayProfiles.employeeId, employeeId))));
}

let permanentId: string;
let deputationistId: string;
let consultantId: string;
let contractualId: string;
let deputationId: string;

beforeAll(async () => {
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: `PP${TENANT.slice(0, 6)}`, name: "Pay Profile Dept", createdBy: MAKER, updatedBy: MAKER });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: `PPD${TENANT.slice(0, 6)}`, name: "Pay Profile Desig", createdBy: MAKER, updatedBy: MAKER });
  });
  permanentId = await seedEmployee("Permanent Person", "permanent");
  deputationistId = await seedEmployee("Deputed In Person", "deputation", 4_490_000n);
  consultantId = await seedEmployee("Consultant Person", "consultant");
  contractualId = await seedEmployee("Contractual Person", "contractual");
});

beforeEach(() => {
  lockedThroughMock.mockReset();
  lockedThroughMock.mockResolvedValue(null);
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(hrmsPayProfiles).where(eq(hrmsPayProfiles.tenantId, TENANT));
    await tx.delete(hrmsDeputations).where(eq(hrmsDeputations.tenantId, TENANT));
    await tx.delete(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

describe("payroll-input feed before any profile exists", () => {
  it("reports govt_scale/default, engagement category, advisories -- and keeps existing fields", async () => {
    const all = await feed("2026-11");
    const perm = all.find((e) => e.id === permanentId)!;
    expect(perm.payProfile).toEqual({ profile: "govt_scale", source: "default", profileId: null, effectiveFrom: null, changedWithinMonth: false });
    expect(perm.engagement).toMatchObject({ category: "legacy", payMode: "monthly" });
    expect(perm.advisories).toEqual([]);
    // pre-existing fields untouched
    expect(perm).toMatchObject({ basicMinor: "5000000", cityClass: "X", pensionScheme: "NPS", paymentRoute: "payroll", eligibleForPayroll: true });
    const contractual = all.find((e) => e.id === contractualId)!;
    expect(contractual.engagement).toMatchObject({ category: "contractual", payMode: "consolidated" });
    expect(contractual.advisories).toEqual(["CONSOLIDATED_ENGAGEMENT_ON_GOVT_SCALE"]);
    const dep = all.find((e) => e.id === deputationistId)!;
    expect(dep.advisories).toEqual(["DEPUTATIONIST_WITHOUT_DEPUTATION_PROFILE"]);
  });
});

describe("deputed-IN deputation with pay terms", () => {
  it("rejects Option A without a station type (422)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${deputationistId}/deputations`, headers: headers(),
      payload: {
        parentCadre: "CSS", borrowingDepartment: "Pay Profile Dept", tenureFrom: "2026-10-15", tenureTo: "2029-10-14",
        direction: "in", payOption: "parent_scale", parentBasicMinor: "4490000",
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("STATION_TYPE_REQUIRED");
  });

  it("records a deputed-IN deputation without switching posting or needing a parent department", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${deputationistId}/deputations`, headers: headers(),
      payload: {
        parentCadre: "CSS", borrowingDepartment: "Pay Profile Dept", tenureFrom: "2026-10-15", tenureTo: "2029-10-14",
        direction: "in", payOption: "parent_scale", stationType: "other", parentOrganisation: "Ministry of X",
        parentPayLevel: 7, parentBasicMinor: "4490000", parentPensionScheme: "NPS",
      },
    });
    expect(r.statusCode).toBe(201);
    deputationId = r.json().id;
    await drain();
    const [d] = await asTenant((tx) => tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.id, deputationId)));
    expect(d).toMatchObject({
      direction: "in", parentDepartmentId: null, payOption: "parent_scale", stationType: "other",
      parentBasicMinor: 4_490_000n, parentPayLevel: 7, allowanceMode: "auto", daSource: "central", foreignService: false,
    });
    const [emp] = await asTenant((tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, deputationistId)));
    expect(emp!.departmentId).toBe(deptId);
    const book = await asTenant((tx) => tx.select().from(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.employeeId, deputationistId)));
    expect(book.map((b) => b.entryType)).toContain("deputation_in");
  });

  it("PATCH pay-terms: per-employee allowance override persists; parent DA without a rate is refused", async () => {
    const bad = await app.inject({ method: "PATCH", url: `/v1/hrms/deputations/${deputationId}/pay-terms`, headers: headers(), payload: { daSource: "parent" } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("PARENT_DA_RATE_REQUIRED");
    const officer = await app.inject({ method: "PATCH", url: `/v1/hrms/deputations/${deputationId}/pay-terms`, headers: headers(MAKER, ["hr_officer"]), payload: { foreignService: true } });
    expect(officer.statusCode).toBe(403);
    const ok = await app.inject({
      method: "PATCH", url: `/v1/hrms/deputations/${deputationId}/pay-terms`, headers: headers(),
      payload: { allowanceMode: "fixed", deputationAllowanceMinor: "300000", foreignService: true },
    });
    expect(ok.statusCode).toBe(202);
    await drain();
    const [d] = await asTenant((tx) => tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.id, deputationId)));
    expect(d).toMatchObject({ allowanceMode: "fixed", deputationAllowanceMinor: 300_000n, foreignService: true, version: 2 });
  });
});

describe("maker-checker pay profile", () => {
  let pendingId: string;

  it("request -> pending row, no effect on the feed", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${deputationistId}/pay-profile`, headers: headers(),
      payload: { payProfile: "deputation_parent_scale", effectiveFrom: "2026-11-01", deputationId, orderRef: "DEP/2026/7" },
    });
    expect(r.statusCode).toBe(202);
    await drain();
    const rows = await profilesOf(deputationistId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", requestedBy: MAKER, payProfile: "deputation_parent_scale" });
    pendingId = rows[0]!.id;
    expect((await feedFor("2026-11", deputationistId)).payProfile.profile).toBe("govt_scale");
  });

  it("refuses a second request while one is pending", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${deputationistId}/pay-profile`, headers: headers(),
      payload: { payProfile: "deputation_parent_scale", effectiveFrom: "2026-12-01", deputationId },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("PROFILE_REQUEST_PENDING");
  });

  it("refuses self-approval", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${pendingId}/approve`, headers: headers(MAKER), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("fails closed when payroll cannot confirm the locked period (503)", async () => {
    lockedThroughMock.mockRejectedValue(new PayrollUnavailableError("down"));
    const r = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${pendingId}/approve`, headers: headers(CHECKER, ["payroll_admin"]), payload: {} });
    expect(r.statusCode).toBe(503);
  });

  it("refuses approval into a locked payroll month (409)", async () => {
    lockedThroughMock.mockResolvedValue("2026-11");
    const r = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${pendingId}/approve`, headers: headers(CHECKER, ["payroll_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("PERIOD_LOCKED");
  });

  it("approval by another user activates it; the feed then carries the deputation pay terms", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${pendingId}/approve`, headers: headers(CHECKER, ["payroll_admin"]), payload: { note: "per DEP/2026/7" } });
    expect(r.statusCode).toBe(202);
    await drain();
    const [row] = await profilesOf(deputationistId);
    expect(row).toMatchObject({ status: "active", decidedBy: CHECKER, decisionNote: "per DEP/2026/7" });

    expect((await feedFor("2026-10", deputationistId)).payProfile.profile).toBe("govt_scale");
    const nov = await feedFor("2026-11", deputationistId);
    expect(nov.payProfile).toMatchObject({ profile: "deputation_parent_scale", source: "assigned", profileId: pendingId, effectiveFrom: "2026-11-01" });
    expect(nov.payProfile.deputation).toMatchObject({
      id: deputationId, direction: "in", option: "parent_scale", stationType: "other", parentBasicMinor: "4490000",
      allowanceMode: "fixed", fixedAllowanceMinor: "300000", foreignService: true, parentPensionScheme: "NPS",
    });
    expect(nov.advisories).toEqual(["FOREIGN_SERVICE_DEPUTATION"]);
  });
});

describe("review fix #1: deputation money terms are locked by a live profile", () => {
  it("PATCH of a money field on a deputation an active profile references -> 409; a non-money field still passes, audited before/after", async () => {
    const money = await app.inject({ method: "PATCH", url: `/v1/hrms/deputations/${deputationId}/pay-terms`, headers: headers(), payload: { parentBasicMinor: "4600000" } });
    expect(money.statusCode).toBe(409);
    expect(money.json().code).toBe("PAY_TERMS_LOCKED_BY_PROFILE");
    for (const payload of [{ stationType: "same" }, { allowanceMode: "auto" }, { deputationAllowanceMinor: "1" }, { daSource: "parent", parentDaRateBps: 4600 }, { parentPayLevel: 8 }]) {
      const r = await app.inject({ method: "PATCH", url: `/v1/hrms/deputations/${deputationId}/pay-terms`, headers: headers(), payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(409);
    }
    const ok = await app.inject({ method: "PATCH", url: `/v1/hrms/deputations/${deputationId}/pay-terms`, headers: headers(), payload: { parentOrganisation: "Ministry of Y" } });
    expect(ok.statusCode).toBe(202);
    await drain();
    const [d] = await asTenant((tx) => tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.id, deputationId)));
    expect(d).toMatchObject({ parentOrganisation: "Ministry of Y", parentBasicMinor: 4_490_000n, stationType: "other" });
    const a = (await audits("deputation", deputationId)).filter((x) => x.action === "update_pay_terms");
    expect(a.at(-1)!.metadata).toMatchObject({ moneyFields: [], before: { parentOrganisation: "Ministry of X" }, after: { parentOrganisation: "Ministry of Y" } });
    expect(a[0]!.metadata).toMatchObject({ before: { allowanceMode: "auto", deputationAllowanceMinor: "0" }, after: { allowanceMode: "fixed", deputationAllowanceMinor: "300000" } });
  });

  it("the consumer re-asserts the lock (a command published past the route changes nothing)", async () => {
    const [before] = await asTenant((tx) => tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.id, deputationId)));
    await queue.publish(COMMANDS.deputationPayTermsUpdate, {
      messageId: randomUUID(), type: COMMANDS.deputationPayTermsUpdate, tenantId: TENANT, actorId: MAKER,
      correlationId: "c", schemaVersion: "1.0",
      payload: { tenantId: TENANT, deputationId, expectedVersion: before!.version, terms: { stationType: "same" } },
    });
    await drain().catch(() => undefined);
    const [after] = await asTenant((tx) => tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.id, deputationId)));
    expect(after).toMatchObject({ stationType: "other", version: before!.version });
  });

  it("a revised term goes through a new profile request: approved copy feeds payroll from its month; earlier months and the deputation row keep the old terms", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${deputationistId}/pay-profile`, headers: headers(),
      payload: { payProfile: "deputation_parent_scale", effectiveFrom: "2027-01-01", deputationId, deputationTerms: { stationType: "same", parentBasicMinor: "4600000" } },
    });
    expect(r.statusCode).toBe(202);
    await drain();
    const pending = (await profilesOf(deputationistId)).find((p) => p.status === "pending")!;
    expect(pending.deputationTerms).toMatchObject({ stationType: "same", parentBasicMinor: "4600000", allowanceMode: "fixed", deputationAllowanceMinor: "300000", payOption: "parent_scale" });
    // pending also locks the money terms
    expect((await app.inject({ method: "PATCH", url: `/v1/hrms/deputations/${deputationId}/pay-terms`, headers: headers(), payload: { postBasicMinor: "1" } })).statusCode).toBe(409);
    const ap = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${pending.id}/approve`, headers: headers(CHECKER, ["payroll_admin"]), payload: { note: "increment" } });
    expect(ap.statusCode).toBe(202);
    await drain();
    expect((await feedFor("2026-12", deputationistId)).payProfile.deputation).toMatchObject({ stationType: "other", parentBasicMinor: "4490000" });
    expect((await feedFor("2027-01", deputationistId)).payProfile.deputation).toMatchObject({ stationType: "same", parentBasicMinor: "4600000", parentOrganisation: "Ministry of Y" });
    const [d] = await asTenant((tx) => tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.id, deputationId)));
    expect(d).toMatchObject({ stationType: "other", parentBasicMinor: 4_490_000n });
    const approve = (await audits("pay_profile", pending.id)).find((x) => x.action === "approve")!;
    expect(approve.metadata).toMatchObject({
      decisionNote: "increment", closedPreviousEffectiveTo: null, closedNewEffectiveTo: "2026-12-31",
      deputationTerms: { stationType: "same", parentBasicMinor: "4600000" },
    });
  });

  it("deputationTerms on a non-deputation profile -> 422", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${permanentId}/pay-profile`, headers: headers(), payload: { payProfile: "ctc_contract", effectiveFrom: "2031-01-01", deputationTerms: { stationType: "same" } } });
    expect([409, 422]).toContain(r.statusCode);
  });
});

describe("review fix #2: the decide consumer re-checks the locked period", () => {
  async function pendingFor(name: string): Promise<{ emp: string; id: string }> {
    const emp = await seedEmployee(name, "permanent");
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${emp}/pay-profile`, headers: headers(), payload: { payProfile: "ctc_contract", effectiveFrom: "2027-05-01" } });
    expect(r.statusCode).toBe(202);
    await drain();
    return { emp, id: (await profilesOf(emp))[0]!.id };
  }

  it("a period locked after the route accepted the approval -> request REJECTED with a PERIOD_LOCKED reason, never activated", async () => {
    const { emp, id } = await pendingFor("Lock Race Person");
    lockedThroughMock.mockClear();
    lockedThroughMock.mockResolvedValueOnce(null).mockResolvedValueOnce("2027-06");
    const r = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${id}/approve`, headers: headers(CHECKER, ["payroll_admin"]), payload: { note: "ok" } });
    expect(r.statusCode).toBe(202);
    await drain().catch(() => undefined);
    const [row] = await profilesOf(emp);
    expect(row!.status).toBe("rejected");
    expect(row!.decisionNote).toMatch(/^PERIOD_LOCKED: payroll is locked through 2027-06/);
    expect((await feedFor("2027-05", emp)).payProfile.profile).toBe("govt_scale");
    const rej = (await audits("pay_profile", id)).find((x) => x.action === "reject")!;
    expect(rej.metadata).toMatchObject({ automatic: true, approverNote: "ok" });
  });

  it("payroll unavailable at decision time is RETRIED (never treated as unlocked or as a rejection)", async () => {
    const { emp, id } = await pendingFor("Lock Retry Person");
    lockedThroughMock.mockClear();
    lockedThroughMock.mockResolvedValueOnce(null).mockRejectedValueOnce(new PayrollUnavailableError("down"));
    const r = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${id}/approve`, headers: headers(CHECKER, ["payroll_admin"]), payload: {} });
    expect(r.statusCode).toBe(202);
    await drain();
    // first consumer attempt failed on the unavailable payroll, the retry saw "not locked"
    expect(lockedThroughMock).toHaveBeenCalledTimes(3);
    expect((await profilesOf(emp))[0]!.status).toBe("active");
  });

  it("reject audit carries the decision note", async () => {
    const { id } = await pendingFor("Reject Note Person");
    const r = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${id}/reject`, headers: headers(CHECKER), payload: { note: "wrong CTC grade" } });
    expect(r.statusCode).toBe(202);
    await drain();
    expect((await audits("pay_profile", id)).find((x) => x.action === "reject")!.metadata).toMatchObject({ decisionNote: "wrong CTC grade" });
  });
});

describe("request validation", () => {
  it("non-payroll engagement (consultant) -> 422", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${consultantId}/pay-profile`, headers: headers(),
      payload: { payProfile: "consolidated_contract", effectiveFrom: "2026-11-01", consolidatedMonthlyMinor: "3000000" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("PROFILE_ENGAGEMENT_MISMATCH");
  });
  it("not the 1st of a month -> 400; consolidated without amount -> 422; hr_officer -> 403", async () => {
    const mid = await app.inject({ method: "POST", url: `/v1/hrms/employees/${contractualId}/pay-profile`, headers: headers(), payload: { payProfile: "consolidated_contract", effectiveFrom: "2026-11-15", consolidatedMonthlyMinor: "3000000" } });
    expect(mid.statusCode).toBe(400);
    const noAmt = await app.inject({ method: "POST", url: `/v1/hrms/employees/${contractualId}/pay-profile`, headers: headers(), payload: { payProfile: "consolidated_contract", effectiveFrom: "2026-11-01" } });
    expect(noAmt.statusCode).toBe(422);
    expect(noAmt.json().code).toBe("CONSOLIDATED_AMOUNT_REQUIRED");
    const officer = await app.inject({ method: "POST", url: `/v1/hrms/employees/${contractualId}/pay-profile`, headers: headers(MAKER, ["hr_officer"]), payload: { payProfile: "consolidated_contract", effectiveFrom: "2026-11-01", consolidatedMonthlyMinor: "3000000" } });
    expect(officer.statusCode).toBe(403);
  });
});

describe("successive profiles close the previous one", () => {
  it("consolidated from Nov, then ctc from Mar: Nov row closed on Feb 28; earlier start refused", async () => {
    const req = async (payload: Record<string, unknown>) => {
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${contractualId}/pay-profile`, headers: headers(), payload });
      return r;
    };
    const approveLatestPending = async () => {
      const pending = (await profilesOf(contractualId)).find((p) => p.status === "pending")!;
      const r = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${pending.id}/approve`, headers: headers(CHECKER, ["hr_admin"]), payload: {} });
      expect(r.statusCode).toBe(202);
      await drain();
      return pending.id;
    };
    expect((await req({ payProfile: "consolidated_contract", effectiveFrom: "2026-11-01", consolidatedMonthlyMinor: "3000000" })).statusCode).toBe(202);
    await drain();
    const first = await approveLatestPending();
    const nov = await feedFor("2026-11", contractualId);
    expect(nov.payProfile).toMatchObject({ profile: "consolidated_contract", consolidatedMonthlyMinor: "3000000" });
    expect(nov.advisories).toEqual([]);

    const early = await req({ payProfile: "ctc_contract", effectiveFrom: "2026-11-01" });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("PROFILE_EFFECTIVE_NOT_AFTER_CURRENT");

    expect((await req({ payProfile: "ctc_contract", effectiveFrom: "2027-03-01" })).statusCode).toBe(202);
    await drain();
    await approveLatestPending();
    const rows = await profilesOf(contractualId);
    expect(rows.find((r) => r.id === first)).toMatchObject({ status: "active", effectiveTo: "2027-02-28" });
    expect((await feedFor("2027-02", contractualId)).payProfile.profile).toBe("consolidated_contract");
    expect((await feedFor("2027-03", contractualId)).payProfile.profile).toBe("ctc_contract");
  });

  it("reject leaves no effect and frees the slot", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${permanentId}/pay-profile`, headers: headers(), payload: { payProfile: "ctc_contract", effectiveFrom: "2026-12-01" } });
    expect(r.statusCode).toBe(202);
    await drain();
    const pending = (await profilesOf(permanentId))[0]!;
    const rej = await app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/${pending.id}/reject`, headers: headers(CHECKER), payload: { note: "wrong" } });
    expect(rej.statusCode).toBe(202);
    await drain();
    expect((await profilesOf(permanentId))[0]).toMatchObject({ status: "rejected", decidedBy: CHECKER });
    expect((await feedFor("2026-12", permanentId)).payProfile.profile).toBe("govt_scale");
    const again = await app.inject({ method: "POST", url: `/v1/hrms/employees/${permanentId}/pay-profile`, headers: headers(), payload: { payProfile: "ctc_contract", effectiveFrom: "2026-12-01" } });
    expect(again.statusCode).toBe(202);
    await drain();
  });
});

describe("separation event input: profile in force on the separation date", () => {
  it("summarises the approved profile (deputation direction / consolidated amount); none -> null", async () => {
    expect(await asTenant((tx) => payProfileAtDateTx(tx, TENANT, deputationistId, "2027-02-15")))
      .toEqual({ profile: "deputation_parent_scale", deputationDirection: "in", consolidatedMonthlyMinor: null });
    expect(await asTenant((tx) => payProfileAtDateTx(tx, TENANT, contractualId, "2027-01-10")))
      .toEqual({ profile: "consolidated_contract", deputationDirection: null, consolidatedMonthlyMinor: "3000000" });
    expect(await asTenant((tx) => payProfileAtDateTx(tx, TENANT, permanentId, "2027-01-10"))).toBeNull();
  });
  it("engagement feed carries the leave-encashment eligibility", async () => {
    expect((await feedFor("2026-11", contractualId)).engagement).toMatchObject({ category: "contractual", leaveEncashment: true });
  });
});

describe("migration 0166 constraints", () => {
  const insert = (o: Record<string, unknown>) => asTenant((tx) => tx.insert(hrmsPayProfiles).values({
    tenantId: TENANT, employeeId: permanentId, payProfile: "govt_scale", effectiveFrom: "2030-01-01", status: "rejected",
    requestedBy: MAKER, createdBy: MAKER, updatedBy: MAKER, ...o,
  } as typeof hrmsPayProfiles.$inferInsert));
  it("rejects a mid-month start, a deputation profile without a deputation, an unknown profile", async () => {
    await expect(insert({ effectiveFrom: "2030-01-15" })).rejects.toThrow();
    await expect(insert({ payProfile: "deputation_post_scale" })).rejects.toThrow();
    await expect(insert({ payProfile: "made_up" })).rejects.toThrow();
    await expect(insert({ payProfile: "consolidated_contract" })).rejects.toThrow();
    // a deputation profile must carry its approved deputation terms
    await expect(insert({ payProfile: "deputation_parent_scale", deputationId: randomUUID() })).rejects.toThrow();
  });
  it("allows only one open active profile per employee", async () => {
    await insert({ status: "active", effectiveFrom: "2031-01-01" });
    await expect(insert({ status: "active", effectiveFrom: "2032-01-01" })).rejects.toThrow();
  });
});

describe("repatriation of a deputed-IN employee", () => {
  it("does not touch the employee's posting", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/deputations/${deputationId}/repatriate`, headers: headers(), payload: { repatriatedOn: "2029-10-14" } });
    expect(r.statusCode).toBe(200);
    await drain();
    const [emp] = await asTenant((tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, deputationistId)));
    expect(emp!.departmentId).toBe(deptId);
    const [d] = await asTenant((tx) => tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.id, deputationId)));
    expect(d!.status).toBe("repatriated");
  });
});
