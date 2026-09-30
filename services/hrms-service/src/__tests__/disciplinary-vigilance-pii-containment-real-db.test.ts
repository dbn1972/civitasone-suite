/**
 * Real-DB regression guard for GAP-HR-DISCIPLINARY-01 / GAP-HR-VIGILANCE-01
 * (PII/DPDP decision packet, interim containment).
 *
 * Reproduction (confirmed before this fix, against this same seeding): both
 * GET /v1/hrms/disciplinary-cases and GET /v1/hrms/vigilance selected
 * `c.allegation AS charges` verbatim — a seeded case with allegation text
 * over 80 chars came back with the full string in the list payload — and
 * neither route excluded 'dropped' (exonerated/discontinued) vigilance
 * cases or wrote an audit record on read. This file locks in the fix:
 *   - both list routes now return a `charges_summary` capped at ~80 chars
 *     (never the seeded full text), while the existing per-case detail
 *     route (disciplinary/routes.ts, untouched by this fix) still returns
 *     the complete allegation behind its own existing role gate;
 *   - GET /v1/hrms/vigilance hides a 'dropped' case by default and only
 *     returns it with an explicit `?includeDropped=true`;
 *   - both routes emit a per-view audit event (hrms.disciplinary.list_viewed
 *     / hrms.vigilance.list_viewed) via the shared outbox.
 *
 * Seeds cases directly (Drizzle insert under withTenantScope), not via the
 * disciplinary state machine's POST routes — this file is about the LIST
 * routes' query/response shape, not case-transition behavior (already
 * covered by disciplinary-state-machine.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR_OFFICER_ACTOR = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-pii-containment" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

const FULL_ALLEGATION =
  "This is a deliberately long seeded allegation string used only to prove " +
  "the list endpoint never ships the complete text, well past eighty characters.";

let app: FastifyInstance;
let employeeId: string;
let longAllegationCaseId: string;
let droppedCaseId: string;

beforeAll(async () => {
  app = await buildApp();

  const deptId = randomUUID();
  const desigId = randomUUID();
  employeeId = randomUUID();
  longAllegationCaseId = randomUUID();
  droppedCaseId = randomUUID();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, async (tx: any) => {
    await tx.insert(hrmsDepartments).values({
      id: deptId, tenantId: TENANT, code: "PIIT", name: "PII Containment Test Dept",
      isActive: true, createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
    });
    await tx.insert(hrmsDesignations).values({
      id: desigId, tenantId: TENANT, code: "PIIT-D", name: "PII Test Designation", level: 5,
      createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: employeeId, tenantId: TENANT, employeeNo: "PIIT-001", fullName: "PII Test Employee",
      departmentId: deptId, designationId: desigId, dateOfJoining: "2020-01-01",
      createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
    });
    await tx.insert(hrmsDisciplinaryCases).values([
      {
        id: longAllegationCaseId, tenantId: TENANT, employeeId, caseNo: "PII-TEST-LONG",
        proceedingType: "major", status: "opened", allegation: FULL_ALLEGATION,
        createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
      },
      {
        id: droppedCaseId, tenantId: TENANT, employeeId, caseNo: "PII-TEST-DROPPED",
        proceedingType: "major", status: "dropped", allegation: "Exonerated case allegation text.",
        createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
      },
    ]);
  });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function auditEventsFor(action: string): Promise<Array<Record<string, unknown>>> {
  // _outbox.messages enforces RLS on this deployment (despite the package's
  // own "deliberately no RLS" doc comment — see the routes.ts comment this
  // fix added), so a bare db.select() with no app.tenant_id GUC set is
  // silently filtered to zero rows, same as any other FORCE-RLS table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, async (tx: any) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return (rows as Array<Record<string, unknown>>).filter(
    (r) => (r.payload as { action?: string })?.action === action,
  );
}

describe("GET /v1/hrms/disciplinary-cases (GAP-HR-DISCIPLINARY-01)", () => {
  it("returns a truncated charges_summary, never the full seeded allegation text", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/disciplinary-cases",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    const bodyText = res.body;
    expect(bodyText.includes(FULL_ALLEGATION)).toBe(false);

    const rows = res.json().data as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === longAllegationCaseId);
    expect(row).toBeTruthy();
    expect(row?.charges).toBeUndefined();
    const summary = row?.charges_summary as string;
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeLessThanOrEqual(81);
    expect(FULL_ALLEGATION.startsWith(summary.replace(/…$/u, ""))).toBe(true);
  });

  it("emits an hrms.disciplinary.list_viewed audit event on each list read", async () => {
    const before = (await auditEventsFor("hrms.disciplinary.list_viewed")).length;
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/disciplinary-cases",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    const after = await auditEventsFor("hrms.disciplinary.list_viewed");
    expect(after.length).toBeGreaterThan(before);
    const last = after[after.length - 1];
    expect(last).toBeTruthy();
    expect(last?.tenantId).toBe(TENANT);
    expect(last?.actorId).toBe(HR_OFFICER_ACTOR);
  });

  it("still 403s a non-HR role (role gate unchanged)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/disciplinary-cases",
      headers: auth(randomUUID(), ["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/disciplinary-cases/:caseId (unchanged detail route)", () => {
  it("still returns the complete, untruncated allegation text behind its existing role gate", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/hrms/disciplinary-cases/${longAllegationCaseId}`,
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().allegation).toBe(FULL_ALLEGATION);
  });
});

describe("GET /v1/hrms/vigilance (GAP-HR-VIGILANCE-01)", () => {
  it("hides a 'dropped' case by default", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/vigilance",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.id === droppedCaseId)).toBeUndefined();
    // the non-dropped major case must still show up (this is containment,
    // not a blanket empty-list bug)
    expect(rows.find((r) => r.id === longAllegationCaseId)).toBeTruthy();
  });

  it("returns the 'dropped' case when includeDropped=true is passed explicitly", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/vigilance?includeDropped=true",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === droppedCaseId);
    expect(row).toBeTruthy();
    // even when explicitly included, it's still the truncated summary, not
    // the full text field name.
    expect(row?.charges).toBeUndefined();
    expect(typeof row?.charges_summary).toBe("string");
  });

  it("truncates charges_summary the same way the disciplinary list does", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/vigilance",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    const bodyText = res.body;
    expect(bodyText.includes(FULL_ALLEGATION)).toBe(false);
    const rows = res.json().data as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === longAllegationCaseId);
    const summary = row?.charges_summary as string;
    expect(summary.length).toBeLessThanOrEqual(81);
  });

  it("emits an hrms.vigilance.list_viewed audit event on each list read", async () => {
    const before = (await auditEventsFor("hrms.vigilance.list_viewed")).length;
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/vigilance",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    const after = await auditEventsFor("hrms.vigilance.list_viewed");
    expect(after.length).toBeGreaterThan(before);
  });

  it("still 403s a non-HR role (role gate unchanged)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/vigilance",
      headers: auth(randomUUID(), ["manager"]),
    });
    expect(res.statusCode).toBe(403);
  });
});
