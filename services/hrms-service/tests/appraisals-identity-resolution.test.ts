/**
 * Appraisals — real-DB identity-resolution + SoD regression (no mocks).
 *
 * Modelled directly on apar-identity-resolution.test.ts (that file's own
 * header explains why a mock-based suite can't catch this class of bug:
 * mocks that set employeeId = actorId in fixtures can never exercise the
 * real identity gap). This file seeds REAL rows into a real Postgres (via
 * withTenantScope, same convention) with employeeId/officer ids
 * deliberately DIFFERENT from the acting actors' JWT `sub`s, then drives
 * the REAL HTTP routes (`app.inject`, no mocks anywhere in this file) --
 * for the write path, it also registers the REAL appraisalAdvanceStage
 * consumer and drains it, then reads the row back directly to prove the
 * transition actually persisted, not just that the route answered 202.
 *
 * Differences from APAR worth calling out explicitly (do not copy APAR's
 * shape blindly -- verify against THIS module's own routes.ts):
 *  - appraisals' role gate for both GET and PATCH .../stage is
 *    [hr_admin, hr_officer, super_admin, manager] -- "employee" is NOT
 *    allowed to call either endpoint at all (pre-existing, unchanged by
 *    this fix), unlike apar/routes.ts's ACTOR_ROLES which includes
 *    "employee". So there is no "employee sees/acts on their own
 *    self_pending appraisal" scenario to test here -- the role gate blocks
 *    it before ownership is ever resolved.
 *  - appraisals' own POST /v1/hrms/appraisals create endpoint does not
 *    collect reportingOfficerId/reviewingOfficerId/acceptingAuthorityId,
 *    so rows are seeded directly via drizzle insert below (bypassing that
 *    endpoint), exactly like apar-identity-resolution.test.ts's own
 *    seedAppraisal helper bypasses POST /v1/hrms/apar for the same reason
 *    (deterministic control over employeeId/officer ids).
 *  - GET's response is validated against AppraisalSummarySchema, whose
 *    `status` enum ("pending"|"in_review"|"completed") is a DIFFERENT,
 *    barely-overlapping vocabulary from PATCH .../stage's own
 *    APPRAISAL_STAGES ("self_pending"|"reporting_officer"|...). This is a
 *    real, PRE-EXISTING mismatch (confirmed via `git log` on both files --
 *    predates this branch, unrelated to this fix): any appraisal actually
 *    advanced through the stage machine would fail GET's response
 *    validation. The read-scope tests below deliberately seed a
 *    schema-compatible "pending" status so they isolate exactly the
 *    scoping behaviour under test rather than tripping over that separate,
 *    pre-existing bug; the write-path tests use the real APPRAISAL_STAGES
 *    values since PATCH's response never goes through that schema.
 *  - queries.listAppraisals is cache-backed (cache.getOrLoad) and this fix
 *    made its cache key vary by resolved scope (previously tenant+limit
 *    only -- a real cross-scope leak risk with no APAR equivalent, since
 *    apar/repo.ts has no cache layer at all). What the cache-scoping test
 *    below discovered in the process: writes NEVER invalidate this cache
 *    (no consumer.ts call to cache.invalidate(...), unlike e.g.
 *    admin-service's custom-domains/scheduled-jobs consumers, which do) --
 *    a separate, real, PRE-EXISTING staleness gap this fix does not
 *    address (out of scope: it's a data-freshness bug, not the
 *    authorization/IDOR bugs this PR closes). Each read-scope test below
 *    therefore uses its OWN fresh tenant so cross-test cache collisions
 *    within the shared CACHE_TTL window can't produce a false pass/fail
 *    independent of that separate gap.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { hrmsAppraisals, type AppraisalRow } from "../src/modules/appraisals/schema.js";
import { registerAppraisalConsumers } from "../src/modules/appraisals/consumer.js";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function auth(tenantId: string, sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: tenantId, roles, sid: "sess-appraisals-identity" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function seedEmployee(tenantId: string, opts: {
  userRef: string; fullName: string; createdBy: string; managerId?: string;
}): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId,
    employeeNo: `REG-${id.slice(0, 8)}`,
    fullName: opts.fullName,
    departmentId: randomUUID(),
    designationId: randomUUID(),
    dateOfJoining: "2020-01-15",
    userRef: opts.userRef,
    ...(opts.managerId ? { managerId: opts.managerId } : {}),
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

async function seedAppraisal(tenantId: string, opts: {
  employeeId: string;
  reportingOfficerId?: string;
  reviewingOfficerId?: string;
  acceptingAuthorityId?: string;
  status: string;
  createdBy: string;
}): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(hrmsAppraisals).values({
    id, tenantId, employeeId: opts.employeeId,
    appraisalPeriod: "2026-27", status: opts.status,
    reportingOfficerId: opts.reportingOfficerId ?? randomUUID(),
    reviewingOfficerId: opts.reviewingOfficerId ?? randomUUID(),
    acceptingAuthorityId: opts.acceptingAuthorityId ?? randomUUID(),
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

/** Direct DB read (bypassing the HTTP layer entirely -- there is no GET
 * /:id route on this module) to prove a PATCH + drain actually persisted,
 * not just that the route answered 202. */
/**
 * Deliberately uses withTenantScope (explicit tenantId), NOT bare
 * scopedRead: scopedRead resolves its tenant GUC from
 * @civitasone/db's tenantStorage AsyncLocalStorage, which is only
 * populated by an in-flight HTTP request (or another withTenantScope
 * callback) -- there is no such ambient context here, this is called
 * directly from a test. A first version of this helper used bare
 * scopedRead and passed when this file ran alone (borrowing whatever ALS
 * context happened to still be active from the immediately-preceding
 * app.inject call in the SAME test) but returned spurious empty reads
 * once unrelated concurrent app.inject calls from OTHER test files
 * interleaved on the event loop and changed the ambient tenant mid-test.
 * withTenantScope sets the GUC explicitly for this call, independent of
 * whatever else is running concurrently -- the same fix seedAppraisal/
 * seedEmployee already use for writes, applied here for the read.
 */
async function readRow(tenantId: string, id: string): Promise<AppraisalRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, tenantId, (tx: any) => tx.select().from(hrmsAppraisals)
    .where(and(eq(hrmsAppraisals.id, id), eq(hrmsAppraisals.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  registerAppraisalConsumers(queue);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Appraisals — real-DB identity resolution (employeeId is hrms_employees.id, not actorId)", () => {
  // Each test below uses its OWN fresh tenant (see file header): the list
  // cache's key varies by scope (this fix) but is never invalidated on
  // write (a separate, pre-existing gap this fix does not address), so
  // reusing one tenant across several hr_admin/manager queries in the same
  // file would let an earlier test's cached snapshot mask a later test's
  // freshly-seeded row -- a false failure unrelated to the scoping logic
  // under test here.

  it("sanity: seeded employeeId genuinely differs from the actor's own JWT sub", async () => {
    const tenant = randomUUID();
    const bobActor = randomUUID();
    const bobEmp = await seedEmployee(tenant, { userRef: bobActor, fullName: "Bob", createdBy: bobActor });
    expect(bobEmp).not.toBe(bobActor);
  });

  it("Bob (real people-manager) sees Alice's appraisal via the manager scope (hrms_employees.managerId)", async () => {
    const tenant = randomUUID();
    const bobActor = randomUUID();
    const aliceActor = randomUUID();
    const bobEmp = await seedEmployee(tenant, { userRef: bobActor, fullName: "Bob Reporting-Officer", createdBy: bobActor });
    const aliceEmp = await seedEmployee(tenant, { userRef: aliceActor, managerId: bobEmp, fullName: "Alice Employee", createdBy: aliceActor });
    // "pending" (NOT an APPRAISAL_STAGES value like "self_pending") is
    // deliberate -- see the file header re: AppraisalSummarySchema's
    // separate, pre-existing status-vocabulary mismatch.
    const id = await seedAppraisal(tenant, { employeeId: aliceEmp, reportingOfficerId: bobEmp, status: "pending", createdBy: bobActor });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(tenant, bobActor, ["manager"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(id);
  });

  it("Carol (an unrelated manager, not Alice's people-manager) does NOT see Alice's appraisal", async () => {
    const tenant = randomUUID();
    const bobActor = randomUUID();
    const aliceActor = randomUUID();
    const carolActor = randomUUID();
    const bobEmp = await seedEmployee(tenant, { userRef: bobActor, fullName: "Bob Reporting-Officer", createdBy: bobActor });
    const aliceEmp = await seedEmployee(tenant, { userRef: aliceActor, managerId: bobEmp, fullName: "Alice Employee", createdBy: aliceActor });
    await seedEmployee(tenant, { userRef: carolActor, fullName: "Carol Unrelated-Manager", createdBy: carolActor });
    const id = await seedAppraisal(tenant, { employeeId: aliceEmp, reportingOfficerId: bobEmp, status: "pending", createdBy: bobActor });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(tenant, carolActor, ["manager"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain(id);
  });

  it("a manager actor with NO resolvable hrms_employees link sees nothing (fails closed, not tenant-wide)", async () => {
    const tenant = randomUUID();
    const bobActor = randomUUID();
    const aliceActor = randomUUID();
    const nolinkActor = randomUUID(); // deliberately gets no hrms_employees row at all
    const bobEmp = await seedEmployee(tenant, { userRef: bobActor, fullName: "Bob Reporting-Officer", createdBy: bobActor });
    const aliceEmp = await seedEmployee(tenant, { userRef: aliceActor, managerId: bobEmp, fullName: "Alice Employee", createdBy: aliceActor });
    const id = await seedAppraisal(tenant, { employeeId: aliceEmp, reportingOfficerId: bobEmp, status: "pending", createdBy: bobActor });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(tenant, nolinkActor, ["manager"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
    // Guard against a false-pass: confirm the row really exists and IS
    // visible to HR (a distinct scope -> distinct cache entry), so the
    // empty result above is scope, not "no data".
    const hrView = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(tenant, nolinkActor, ["hr_admin"]) });
    expect((hrView.json() as Array<{ id: string }>).map((a) => a.id)).toContain(id);
  });

  it("hr_admin sees the appraisal regardless of the reporting line (unrestricted scope)", async () => {
    const tenant = randomUUID();
    const bobActor = randomUUID();
    const aliceActor = randomUUID();
    const bobEmp = await seedEmployee(tenant, { userRef: bobActor, fullName: "Bob Reporting-Officer", createdBy: bobActor });
    const aliceEmp = await seedEmployee(tenant, { userRef: aliceActor, managerId: bobEmp, fullName: "Alice Employee", createdBy: aliceActor });
    const id = await seedAppraisal(tenant, { employeeId: aliceEmp, reportingOfficerId: bobEmp, status: "pending", createdBy: bobActor });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(tenant, randomUUID(), ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as Array<{ id: string }>).map((a) => a.id)).toContain(id);
  });

  it("cache-scoping: an unrestricted HR read and a scoped manager read for the same tenant do not leak into each other's cache entry", async () => {
    // Regression for a risk found while building this fix, not something
    // APAR had to solve (apar/repo.ts's listAppraisals has no cache layer
    // at all): queries.ts's cache key MUST vary by resolved scope, or
    // whichever caller queries first primes a cache entry the other reuses.
    // (This test seeds all its data BEFORE either read, specifically to
    // stay clear of the separate no-invalidation-on-write gap documented
    // in the file header -- it is proving key-scoping, not freshness.)
    const tenant = randomUUID();
    const bobActor = randomUUID();
    const aliceActor = randomUUID();
    const carolActor = randomUUID();
    const bobEmp = await seedEmployee(tenant, { userRef: bobActor, fullName: "Bob Reporting-Officer", createdBy: bobActor });
    const aliceEmp = await seedEmployee(tenant, { userRef: aliceActor, managerId: bobEmp, fullName: "Alice Employee", createdBy: aliceActor });
    await seedEmployee(tenant, { userRef: carolActor, fullName: "Carol Unrelated-Manager", createdBy: carolActor });
    const id = await seedAppraisal(tenant, { employeeId: aliceEmp, reportingOfficerId: bobEmp, status: "pending", createdBy: bobActor });

    // Prime Carol's (unrelated manager) SCOPED cache entry first.
    const carolFirst = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(tenant, carolActor, ["manager"]) });
    expect((carolFirst.json() as Array<{ id: string }>).map((a) => a.id)).not.toContain(id);
    // HR's UNRESTRICTED read right after must still see it -- if the cache
    // key collided on tenant+limit alone (pre-fix behaviour), this would
    // incorrectly return Carol's cached (scoped, empty-of-this-row) result.
    const hrAfter = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(tenant, randomUUID(), ["hr_admin"]) });
    expect((hrAfter.json() as Array<{ id: string }>).map((a) => a.id)).toContain(id);
    // And Bob's (real manager) scoped read right after HR's unrestricted
    // one must still correctly include it -- the inverse collision.
    const bobAfter = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(tenant, bobActor, ["manager"]) });
    expect((bobAfter.json() as Array<{ id: string }>).map((a) => a.id)).toContain(id);
  });
});

describe("Appraisals — real-DB stage-ownership (SoD) regression, via the real async consumer", () => {
  // This block shares one tenant + one officer roster across its tests:
  // PATCH .../stage never reads through queries.listAppraisals's cache, so
  // it isn't subject to the staleness gap the block above works around.
  const TENANT = randomUUID();
  const BOB_ACTOR = randomUUID();    // real people-manager AND reporting officer
  const CAROL_ACTOR = randomUUID();  // an unrelated manager -- not in Alice's reporting line at all
  const DAVE_ACTOR = randomUUID();   // reviewing officer
  const EVE_ACTOR = randomUUID();    // accepting authority
  let aliceEmpId: string;
  let bobEmpId: string;
  let daveEmpId: string;
  let eveEmpId: string;

  beforeAll(async () => {
    bobEmpId = await seedEmployee(TENANT, { userRef: BOB_ACTOR, fullName: "Bob Reporting-Officer", createdBy: BOB_ACTOR });
    aliceEmpId = await seedEmployee(TENANT, { userRef: randomUUID(), managerId: bobEmpId, fullName: "Alice Employee", createdBy: BOB_ACTOR });
    await seedEmployee(TENANT, { userRef: CAROL_ACTOR, fullName: "Carol Unrelated-Manager", createdBy: CAROL_ACTOR });
    daveEmpId = await seedEmployee(TENANT, { userRef: DAVE_ACTOR, fullName: "Dave Reviewing-Officer", createdBy: DAVE_ACTOR });
    eveEmpId = await seedEmployee(TENANT, { userRef: EVE_ACTOR, fullName: "Eve Accepting-Authority", createdBy: EVE_ACTOR });
  });

  it("Bob (real reporting officer) CAN legitimately advance Alice's appraisal end-to-end (persisted, not just the 202)", async () => {
    const id = await seedAppraisal(TENANT, { employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "reporting_officer", createdBy: BOB_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${id}/stage`,
      headers: auth(TENANT, BOB_ACTOR, ["manager"]), payload: { stage: "reviewing_officer" },
    });
    expect(r.statusCode).toBe(202);
    await drain();
    const row = await readRow(TENANT, id);
    expect(row?.status).toBe("reviewing_officer"); // really persisted, not just the optimistic response
  });

  it("Carol (an unrelated manager, not the reporting officer) CANNOT advance Alice's appraisal (SoD closed)", async () => {
    const id = await seedAppraisal(TENANT, { employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "reporting_officer", createdBy: BOB_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${id}/stage`,
      headers: auth(TENANT, CAROL_ACTOR, ["manager"]), payload: { stage: "reviewing_officer" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_STAGE_OWNER");
    await drain();
    const row = await readRow(TENANT, id);
    expect(row?.status).toBe("reporting_officer"); // unchanged -- rejected before publish, nothing to drain
  });

  it("hr_admin holding the role but not the resolved officer CANNOT finalise/rate someone else's appraisal (no automatic HR bypass)", async () => {
    const id = await seedAppraisal(TENANT, { employeeId: aliceEmpId, reportingOfficerId: bobEmpId, acceptingAuthorityId: eveEmpId, status: "accepting_authority", createdBy: BOB_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${id}/stage`,
      headers: auth(TENANT, randomUUID(), ["hr_admin"]), payload: { stage: "completed", rating: "9.5" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_STAGE_OWNER");
    await drain();
    const row = await readRow(TENANT, id);
    expect(row?.status).toBe("accepting_authority");
    expect(row?.rating).toBeNull();
  });

  it("a real appraisal progresses through its full stage chain end-to-end, each transition by its actual named officer", async () => {
    const id = await seedAppraisal(TENANT, {
      employeeId: aliceEmpId, reportingOfficerId: bobEmpId, reviewingOfficerId: daveEmpId, acceptingAuthorityId: eveEmpId,
      status: "self_pending", createdBy: BOB_ACTOR,
    });

    // self_pending -> reporting_officer: owned by employeeId (Alice), but
    // "employee" role can never call this route at all (role-gated out
    // before ownership resolution) -- only super_admin can move a row out
    // of self_pending via this endpoint under the current role gate. This
    // is a real, pre-existing limitation of this module's role gate (not
    // something this fix introduces or is asked to change) -- documented
    // here rather than silently worked around.
    const step1 = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${id}/stage`,
      headers: auth(TENANT, randomUUID(), ["super_admin"]), payload: { stage: "reporting_officer" },
    });
    expect(step1.statusCode).toBe(202);
    await drain();
    expect((await readRow(TENANT, id))?.status).toBe("reporting_officer");

    // reporting_officer -> reviewing_officer: Bob is the real reporting officer.
    const step2 = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${id}/stage`,
      headers: auth(TENANT, BOB_ACTOR, ["manager"]), payload: { stage: "reviewing_officer" },
    });
    expect(step2.statusCode).toBe(202);
    await drain();
    expect((await readRow(TENANT, id))?.status).toBe("reviewing_officer");

    // reviewing_officer -> accepting_authority: Dave is the real reviewing officer.
    const step3 = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${id}/stage`,
      headers: auth(TENANT, DAVE_ACTOR, ["manager"]), payload: { stage: "accepting_authority" },
    });
    expect(step3.statusCode).toBe(202);
    await drain();
    expect((await readRow(TENANT, id))?.status).toBe("accepting_authority");

    // accepting_authority -> completed: Eve is the real accepting authority,
    // and records the final rating.
    const step4 = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${id}/stage`,
      headers: auth(TENANT, EVE_ACTOR, ["manager"]), payload: { stage: "completed", rating: "8.7" },
    });
    expect(step4.statusCode).toBe(202);
    await drain();
    const final = await readRow(TENANT, id);
    expect(final?.status).toBe("completed");
    expect(final?.rating).toBe("8.7");
  });

  it("cannot jump straight from self_pending to completed (monotonic stage order enforced end-to-end)", async () => {
    const id = await seedAppraisal(TENANT, { employeeId: aliceEmpId, reportingOfficerId: bobEmpId, acceptingAuthorityId: eveEmpId, status: "self_pending", createdBy: BOB_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${id}/stage`,
      headers: auth(TENANT, randomUUID(), ["super_admin"]), payload: { stage: "completed", rating: "10.0" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STAGE");
    await drain();
    const row = await readRow(TENANT, id);
    expect(row?.status).toBe("self_pending");
    expect(row?.rating).toBeNull();
  });
});
