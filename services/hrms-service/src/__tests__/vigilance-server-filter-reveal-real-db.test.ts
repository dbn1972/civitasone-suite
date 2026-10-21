/**
 * Real-DB regression guard for GAP-HR-VIGILANCE-04 and GAP-HR-VIGILANCE-01.
 *
 * VIGILANCE-04: the register used to filter only inside the already-loaded
 * batch, so with more than 200 major cases a status or search filter could
 * never reach case 201+. `status` and `q` are now applied in SQL, with the
 * total/hasMore counting the FILTERED set. Seeds 250 major cases (the
 * acceptance case: page 2 returns the remaining 50 and total 250) with the
 * oldest few being the only ones of their status, so they sit beyond the first
 * 200 of the unfiltered order.
 *
 * VIGILANCE-01: `maskCharges=true` withholds the charge text from the list, and
 * POST /v1/hrms/vigilance/:id/charges/reveal is the audited, reason-bearing,
 * fail-closed way to read it.
 *
 * Real DB (no mocks), same seeding precedent as
 * disciplinary-vigilance-pagination-real-db.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsDepartments, hrmsDesignations, hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsDisciplinaryCases } from "../modules/disciplinary/schema.js";
import type { FastifyInstance } from "fastify";

// Set by this package's vitest config (env.JWT_SECRET); never a literal here.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const HR_OFFICER = randomUUID();

function auth(roles: string[], sub = HR_OFFICER, tid = TENANT): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid, roles, sid: "sess-vig-filter" }, SECRET, 3600)}` };
}
const get = (qs: string, roles = ["hr_officer"]) =>
  app.inject({ method: "GET", url: `/v1/hrms/vigilance${qs}`, headers: auth(roles) });
const reveal = (id: string, body: unknown, roles = ["hr_officer"], tid = TENANT) =>
  app.inject({ method: "POST", url: `/v1/hrms/vigilance/${id}/charges/reveal`, headers: { ...auth(roles, HR_OFFICER, tid), "content-type": "application/json" }, payload: JSON.stringify(body) });

let app: FastifyInstance;

const SECRET_ALLEGATION = "Confidential allegation text ZEBRAWORD about a named officer, long enough to be truncated at eighty characters for the list view.";
const N_OPENED = 245;
const N_CLOSED = 4;
const closedIds: string[] = [];
const idsByNo: Record<string, string> = {};
let minorId: string;
let droppedId: string;
let otherTenantCaseId: string;

async function auditRows(action: string): Promise<Array<{ actorId: string; payload: Record<string, unknown> }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, async (tx: any) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return (rows as Array<{ actorId: string; payload: Record<string, unknown> }>).filter((r) => r.payload?.action === action);
}

beforeAll(async () => {
  app = await buildApp();
  const deptA = randomUUID(), deptB = randomUUID(), desig = randomUUID();
  const empA = randomUUID(), empB = randomUUID();
  const oldest = new Date("2020-01-01T00:00:00.000Z");
  const row = (over: Record<string, unknown>): Record<string, unknown> => ({
    id: randomUUID(), tenantId: TENANT, employeeId: empA, proceedingType: "major", status: "opened",
    allegation: SECRET_ALLEGATION, createdBy: HR_OFFICER, updatedBy: HR_OFFICER, ...over,
  });
  const cases: Array<Record<string, unknown>> = [];
  for (let i = 0; i < N_OPENED; i++) cases.push(row({ caseNo: `VG-OPEN-${String(i).padStart(3, "0")}` }));
  for (let i = 0; i < N_CLOSED; i++) {
    const c = row({ caseNo: `VG-CLOSED-${i}`, status: "closed", employeeId: empB, createdAt: oldest });
    closedIds.push(c.id as string);
    cases.push(c);
  }
  const penalty = row({ caseNo: "VG-PENALTY-1", status: "penalty_imposed", employeeId: empB, createdAt: oldest });
  cases.push(penalty);
  droppedId = randomUUID();
  cases.push(row({ id: droppedId, caseNo: "VG-DROPPED-1", status: "dropped", createdAt: oldest }));
  minorId = randomUUID();
  cases.push(row({ id: minorId, caseNo: "VG-MINOR-1", proceedingType: "minor" }));
  for (const c of cases) idsByNo[c.caseNo as string] = c.id as string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, async (tx: any) => {
    await tx.insert(hrmsDepartments).values([
      { id: deptA, tenantId: TENANT, code: "VGA", name: "Revenue Vigilance Dept", isActive: true, createdBy: HR_OFFICER, updatedBy: HR_OFFICER },
      { id: deptB, tenantId: TENANT, code: "VGB", name: "Works Department", isActive: true, createdBy: HR_OFFICER, updatedBy: HR_OFFICER },
    ]);
    await tx.insert(hrmsDesignations).values({ id: desig, tenantId: TENANT, code: "VG-D", name: "Officer", level: 5, createdBy: HR_OFFICER, updatedBy: HR_OFFICER });
    await tx.insert(hrmsEmployees).values([
      { id: empA, tenantId: TENANT, employeeNo: "VG-001", fullName: "Alpha Officer", departmentId: deptA, designationId: desig, dateOfJoining: "2020-01-01", createdBy: HR_OFFICER, updatedBy: HR_OFFICER },
      { id: empB, tenantId: TENANT, employeeNo: "VG-002", fullName: "Beta Clerk", departmentId: deptB, designationId: desig, dateOfJoining: "2020-01-01", createdBy: HR_OFFICER, updatedBy: HR_OFFICER },
    ]);
    await tx.insert(hrmsDisciplinaryCases).values(cases);
  });

  // A case in ANOTHER tenant, to prove the reveal cannot cross tenants.
  const odept = randomUUID(), odesig = randomUUID(), oemp = randomUUID();
  otherTenantCaseId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, OTHER_TENANT, async (tx: any) => {
    await tx.insert(hrmsDepartments).values({ id: odept, tenantId: OTHER_TENANT, code: "OV", name: "Other", isActive: true, createdBy: HR_OFFICER, updatedBy: HR_OFFICER });
    await tx.insert(hrmsDesignations).values({ id: odesig, tenantId: OTHER_TENANT, code: "OV-D", name: "Officer", level: 5, createdBy: HR_OFFICER, updatedBy: HR_OFFICER });
    await tx.insert(hrmsEmployees).values({ id: oemp, tenantId: OTHER_TENANT, employeeNo: "OV-001", fullName: "Other Tenant Officer", departmentId: odept, designationId: odesig, dateOfJoining: "2020-01-01", createdBy: HR_OFFICER, updatedBy: HR_OFFICER });
    await tx.insert(hrmsDisciplinaryCases).values({ id: otherTenantCaseId, tenantId: OTHER_TENANT, employeeId: oemp, caseNo: "OTHER-1", proceedingType: "major", status: "opened", allegation: "Other tenant allegation text", createdBy: HR_OFFICER, updatedBy: HR_OFFICER });
  });
}, 60_000);

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// Visible (non-dropped) major cases: 245 opened + 4 closed + 1 penalty = 250.
const VISIBLE = N_OPENED + N_CLOSED + 1;

describe("GET /v1/hrms/vigilance -- 250 cases (GAP-HR-VIGILANCE-04)", () => {
  it("page 1 returns 200, page 2 the remaining 50, total 250 -- no case lost or repeated", async () => {
    const p1 = (await get("?limit=200&offset=0")).json();
    expect(p1.data).toHaveLength(200);
    expect(p1.total).toBe(VISIBLE);
    expect(p1.hasMore).toBe(true);
    const p2 = (await get("?limit=200&offset=200")).json();
    expect(p2.data).toHaveLength(50);
    expect(p2.total).toBe(VISIBLE);
    expect(p2.hasMore).toBe(false);
    const ids = [...p1.data, ...p2.data].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(VISIBLE);
  });

  it("stat cards are whole-tenant counts, not page counts", async () => {
    const { stats } = (await get("?limit=10")).json();
    expect(stats).toMatchObject({ total: VISIBLE + 1, closed: N_CLOSED, dropped: 1, penaltyAndAppeal: 1, chargeMemoStage: N_OPENED });
  });
});

describe("GET /v1/hrms/vigilance -- server-side status filter (GAP-HR-VIGILANCE-04)", () => {
  it("returns the closed cases that sit beyond the first 200 of the unfiltered order", async () => {
    const unfilteredFirst200 = new Set(((await get("?limit=200&offset=0")).json().data as Array<{ id: string }>).map((r) => r.id));
    expect(closedIds.some((id) => unfilteredFirst200.has(id))).toBe(false); // they really are past row 200
    const res = (await get("?status=closed")).json();
    expect(res.data.map((r: { id: string }) => r.id).sort()).toEqual([...closedIds].sort());
    expect(res.total).toBe(N_CLOSED);
    expect(res.hasMore).toBe(false);
  });

  it("total and hasMore count the filtered set when paging a filtered view", async () => {
    const res = (await get("?status=opened&limit=100&offset=0")).json();
    expect(res.data).toHaveLength(100);
    expect(res.total).toBe(N_OPENED);
    expect(res.hasMore).toBe(true);
  });

  it("'dropped' stays hidden unless includeDropped=true -- a filter can only narrow what the caller could already see", async () => {
    expect((await get("?status=dropped")).json().data).toHaveLength(0);
    const shown = (await get("?status=dropped&includeDropped=true")).json();
    expect(shown.data.map((r: { id: string }) => r.id)).toEqual([droppedId]);
  });

  it("rejects an unknown status (400)", async () => {
    expect((await get("?status=banana")).statusCode).toBe(400);
  });
});

describe("GET /v1/hrms/vigilance -- server-side search (GAP-HR-VIGILANCE-04)", () => {
  it("matches employee name, department, case number (case-insensitively) across every case", async () => {
    expect((await get("?q=beta")).json().total).toBe(N_CLOSED + 1);
    expect((await get("?q=works%20department")).json().total).toBe(N_CLOSED + 1);
    const byNo = (await get("?q=vg-closed-3")).json();
    expect(byNo.data.map((r: { id: string }) => r.id)).toEqual([idsByNo["VG-CLOSED-3"]]);
  });

  it("never matches the allegation text (DPDP: charge text is not searchable)", async () => {
    expect((await get("?q=ZEBRAWORD")).json().total).toBe(0);
  });

  it("treats LIKE wildcards literally instead of matching everything", async () => {
    expect((await get("?q=%25")).json().total).toBe(0);
    expect((await get("?q=_")).json().total).toBe(0);
  });

  it("combines with status, and rejects an over-long query (400)", async () => {
    expect((await get("?q=beta&status=penalty_imposed")).json().total).toBe(1);
    expect((await get(`?q=${"x".repeat(101)}`)).statusCode).toBe(400);
  });
});

describe("charge-summary masking and audited reveal (GAP-HR-VIGILANCE-01)", () => {
  it("by default the list is unchanged: a truncated summary, hasCharges true", async () => {
    const row = (await get("?q=VG-OPEN-000")).json().data[0];
    expect(typeof row.charges_summary).toBe("string");
    expect(row.charges_summary.length).toBeLessThanOrEqual(81);
    expect(row.hasCharges).toBe(true);
  });

  it("maskCharges=true withholds the charge text from the response entirely", async () => {
    const res = await get("?maskCharges=true&limit=200");
    const body = res.json();
    expect(body.chargesMasked).toBe(true);
    expect(body.data.every((r: { charges_summary: unknown; hasCharges: boolean }) => r.charges_summary === null && r.hasCharges === true)).toBe(true);
    expect(res.body).not.toContain("ZEBRAWORD");
    expect(res.body).not.toContain("Confidential allegation");
  });

  it("reveal returns the charge summary and writes an audit event with actor, case and reason -- not the text", async () => {
    const id = idsByNo["VG-OPEN-001"]!;
    const before = (await auditRows("hrms.vigilance.charges_revealed")).length;
    const res = await reveal(id, { reason: "Reviewing the charge for the hearing brief" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { data } = res.json();
    expect(data).toMatchObject({ resourceType: "disciplinary_case", resourceId: id, field: "charges_summary" });
    expect(data.value.startsWith("Confidential allegation text ZEBRAWORD")).toBe(true);
    expect(data.value.length).toBeLessThanOrEqual(81);
    const after = await auditRows("hrms.vigilance.charges_revealed");
    expect(after.length).toBe(before + 1);
    const evt = after[after.length - 1]!;
    expect(evt.actorId).toBe(HR_OFFICER);
    expect(evt.payload).toMatchObject({ resourceType: "disciplinary_case", resourceId: id, field: "charges_summary", reason: "Reviewing the charge for the hearing brief" });
    expect(JSON.stringify(evt.payload)).not.toContain("ZEBRAWORD");
  });

  it("requires a reason of at least 10 characters (400) and audits nothing when refused", async () => {
    const before = (await auditRows("hrms.vigilance.charges_revealed")).length;
    expect((await reveal(idsByNo["VG-OPEN-002"]!, { reason: "short" })).statusCode).toBe(400);
    expect((await reveal(idsByNo["VG-OPEN-002"]!, {})).statusCode).toBe(400);
    expect((await auditRows("hrms.vigilance.charges_revealed")).length).toBe(before);
  });

  it("is HR-only (403), 404s an unknown id, a minor-proceeding case and another tenant's case", async () => {
    const reason = { reason: "Reviewing the charge for the hearing brief" };
    expect((await reveal(idsByNo["VG-OPEN-003"]!, reason, ["manager"])).statusCode).toBe(403);
    expect((await reveal(idsByNo["VG-OPEN-003"]!, reason, ["employee"])).statusCode).toBe(403);
    expect((await reveal(randomUUID(), reason)).statusCode).toBe(404);
    expect((await reveal(minorId, reason)).statusCode).toBe(404);
    expect((await reveal(otherTenantCaseId, reason)).statusCode).toBe(404);
  });

  it("fails CLOSED: if the audit event cannot be queued, no charge text is returned", async () => {
    const spy = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("audit queue down"));
    try {
      const res = await reveal(idsByNo["VG-OPEN-004"]!, { reason: "Reviewing the charge for the hearing brief" });
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("ZEBRAWORD");
      expect(res.body).not.toContain("Confidential allegation");
    } finally {
      spy.mockRestore();
    }
  });
});
