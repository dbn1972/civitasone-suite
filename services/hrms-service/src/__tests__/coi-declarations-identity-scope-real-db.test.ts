/**
 * COI declarations — real-DB identity-resolution regression (no mocks).
 *
 * SEC finding: POST/GET /v1/hrms/employees/:id/declarations and POST
 * /v1/hrms/declarations/:declId/acknowledge let ALL_ROLES (which includes
 * bare "employee" and "manager") act on an arbitrary :id/declId with zero
 * ownership check -- read a colleague's COI declaration, file one falsely
 * attributed to a colleague (only the target's existence-in-tenant was
 * checked, never that it was the caller), or falsely mark any colleague's
 * declaration "acknowledged". Fixed via coi-routes.ts's
 * assertOwnEmployeeOrPrivileged, which resolves the caller's OWN
 * hrms_employees row through resolveEmployeeForActor (userRef = actorId)
 * rather than comparing ctx.actorId to employeeId directly -- two different
 * id spaces (see actor-link.ts).
 *
 * Real DB (no mocks), following this codebase's own established precedent
 * for identity-resolution fixes (apar-identity-resolution.test.ts,
 * manager-employee-read-scope-real-db.test.ts): a mocked test that sets
 * employeeId = actorId in its fixtures could never have caught this class
 * of bug, since the whole defect is that those two ids live in different
 * spaces and must be resolved through hrms_employees.user_ref.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsCoiDeclarations } from "../modules/disciplinary/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Fresh tenant per run: every query in this module is tenant-scoped, so this
// gives hermetic isolation from any other data in the shared dev DB
// (including other worktrees/agents running against the same DB) with no
// explicit cleanup needed -- same convention apar-identity-resolution.test.ts
// and apar-nested-tx-deadlock.test.ts use.
const TENANT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-coi-identity" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function seedEmployee(opts: { userRef: string; fullName: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT,
    employeeNo: `REG-${id.slice(0, 8)}`,
    fullName: opts.fullName,
    departmentId: randomUUID(),
    designationId: randomUUID(),
    dateOfJoining: "2020-01-15",
    userRef: opts.userRef,
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

async function seedDeclaration(opts: { employeeId: string; createdBy: string; status?: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsCoiDeclarations).values({
    id, tenantId: TENANT, employeeId: opts.employeeId,
    declarationType: "coi", declarationDate: "2026-01-15",
    details: "Shareholding in a vendor firm", status: opts.status ?? "active",
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

// Actor ids (JWT `sub`) -- deliberately random and UNRELATED to any
// hrms_employees.id below; only each employee row's userRef ties them
// together, exactly like a real onboarded user.
const ALICE_ACTOR = randomUUID();
const BOB_ACTOR = randomUUID();
const HR_ACTOR = randomUUID();
const UNLINKED_ACTOR = randomUUID(); // "employee" role, no hrms_employees row at all

let app: FastifyInstance;
let aliceEmpId: string;
let bobEmpId: string;

beforeAll(async () => {
  app = await buildApp();
  aliceEmpId = await seedEmployee({ userRef: ALICE_ACTOR, fullName: "Alice Employee", createdBy: HR_ACTOR });
  bobEmpId = await seedEmployee({ userRef: BOB_ACTOR, fullName: "Bob Colleague", createdBy: HR_ACTOR });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("COI declarations — identity resolution sanity", () => {
  it("seeded employeeId genuinely differs from the actor's own JWT sub", () => {
    // The exact real-world condition the vulnerable ctx.actorId===id shape
    // would have gotten wrong.
    expect(aliceEmpId).not.toBe(ALICE_ACTOR);
    expect(bobEmpId).not.toBe(BOB_ACTOR);
  });
});

describe("POST /v1/hrms/employees/:id/declarations — forge prevention", () => {
  it("Bob (employee) cannot file a declaration attributed to Alice (403, not 201)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${aliceEmpId}/declarations`,
      headers: auth(BOB_ACTOR, ["employee"]),
      payload: { declarationType: "coi", declarationDate: "2026-01-15", details: "forged" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
  });

  it("a manager-only caller also cannot file a declaration attributed to Alice (403) -- manager is not privileged for COI", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${aliceEmpId}/declarations`,
      headers: auth(BOB_ACTOR, ["manager"]),
      payload: { declarationType: "coi", declarationDate: "2026-01-15", details: "forged" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("an actor with no linked employee row at all is forbidden even on a real target id (fails closed)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${aliceEmpId}/declarations`,
      headers: auth(UNLINKED_ACTOR, ["employee"]),
      payload: { declarationType: "coi", declarationDate: "2026-01-15", details: "x" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("Alice (employee) CAN file her own declaration (not blocked by the ownership guard)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${aliceEmpId}/declarations`,
      headers: auth(ALICE_ACTOR, ["employee"]),
      payload: { declarationType: "coi", declarationDate: "2026-01-15", details: "genuine self-declaration" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.employeeId).toBe(aliceEmpId);
  });

  it("hr_admin CAN file a declaration on Alice's behalf (privileged role unaffected)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${aliceEmpId}/declarations`,
      headers: auth(HR_ACTOR, ["hr_admin"]),
      payload: { declarationType: "property", declarationDate: "2026-01-15", details: "HR-filed" },
    });
    expect(r.statusCode).toBe(201);
  });
});

describe("GET /v1/hrms/employees/:id/declarations — read leak prevention", () => {
  it("Bob (employee) cannot list Alice's declarations (403, not the data)", async () => {
    await seedDeclaration({ employeeId: aliceEmpId, createdBy: HR_ACTOR });
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${aliceEmpId}/declarations`,
      headers: auth(BOB_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
  });

  it("Alice (employee) CAN list her own declarations", async () => {
    const declId = await seedDeclaration({ employeeId: aliceEmpId, createdBy: HR_ACTOR });
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${aliceEmpId}/declarations`,
      headers: auth(ALICE_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((d) => d.id);
    expect(ids).toContain(declId);
  });

  it("hr_officer CAN list Alice's declarations (privileged role unaffected)", async () => {
    // Not vigilance_officer here: this route's own requireRole(ALL_ROLES)
    // gate (pre-existing, unchanged by this fix) does not include
    // vigilance_officer at all -- only revoke does (VIGILANCE_ROLES). A bare
    // vigilance_officer account can revoke a declaration but was already
    // unable to reach list/create/acknowledge before this fix; that
    // role-gate asymmetry is pre-existing and out of scope here. hr_officer
    // is in both ALL_ROLES (reaches this route) and VIGILANCE_ROLES (bypasses
    // the new ownership check), so it genuinely exercises "privileged roles
    // are unaffected" the way hr_admin does for the create/acknowledge tests
    // above/below.
    const declId = await seedDeclaration({ employeeId: aliceEmpId, createdBy: HR_ACTOR });
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${aliceEmpId}/declarations`,
      headers: auth(HR_ACTOR, ["hr_officer"]),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((d) => d.id);
    expect(ids).toContain(declId);
  });
});

describe("POST /v1/hrms/declarations/:declId/acknowledge — false-acknowledge prevention", () => {
  it("Bob (employee) cannot acknowledge Alice's declaration (403, not 200)", async () => {
    const declId = await seedDeclaration({ employeeId: aliceEmpId, createdBy: HR_ACTOR });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/declarations/${declId}/acknowledge`,
      headers: auth(BOB_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
  });

  it("Alice (employee) CAN acknowledge her own declaration", async () => {
    const declId = await seedDeclaration({ employeeId: aliceEmpId, createdBy: HR_ACTOR });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/declarations/${declId}/acknowledge`,
      headers: auth(ALICE_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.acknowledged).toBe(true);
  });

  it("returns 404 for an unknown declId (ownership check does not leak existence)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/declarations/${randomUUID()}/acknowledge`,
      headers: auth(BOB_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(404);
  });

  it("returns 409 (not 200) when Alice tries to re-acknowledge an already-revoked declaration", async () => {
    const declId = await seedDeclaration({ employeeId: aliceEmpId, createdBy: HR_ACTOR, status: "revoked" });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/declarations/${declId}/acknowledge`,
      headers: auth(ALICE_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(409);
  });
});
