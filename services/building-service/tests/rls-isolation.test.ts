/**
 * Cross-Tenant RLS Isolation — building-service
 *
 * Building-service had zero real-DB tests before this pass (all 4 consumer
 * test files mocked shared/db.js entirely), so RLS on its 5 tenant tables
 * (building_applications, building_scrutiny, building_permits,
 * building_certificates, building_renewals — all ENABLE + FORCE ROW LEVEL
 * SECURITY per migrations/0001_init.sql) had never been exercised against a
 * real Postgres. This proves it actually holds: tenant A creates an
 * application, tenant B must not be able to read it — by id or by list —
 * through the real HTTP routes with real signed JWTs. Also drives a permit
 * all the way through so building_permits (not just building_applications)
 * is covered.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { db, sqlClient } from "../src/shared/db.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import * as applicationsRepo from "../src/modules/applications/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ACTOR_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const ACTOR_B = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

function tokenForTenant(tenantId: string, actorId: string, roles: string[]) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-rls" }, SECRET, 3600);
}

const authA = { authorization: `Bearer ${tokenForTenant(TENANT_A, ACTOR_A, ["building_admin"])}` };
const authB = { authorization: `Bearer ${tokenForTenant(TENANT_B, ACTOR_B, ["building_admin"])}` };

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerPermitConsumers(queue);
});

afterAll(async () => {
  // Ultimate safety net, independent of the sabotage test's own transaction
  // and try/finally below: if this file (now or after some future edit)
  // ever leaves building_applications with RLS off, restore it before the
  // connection closes rather than let a disabled table survive the run.
  // Idempotent — a no-op whenever the test's own restore already worked.
  const [state] = await sqlClient<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
    SELECT relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE oid = 'building.building_applications'::regclass
  `;
  if (state && (!state.relrowsecurity || !state.relforcerowsecurity)) {
    await sqlClient`ALTER TABLE building.building_applications ENABLE ROW LEVEL SECURITY`;
    await sqlClient`ALTER TABLE building.building_applications FORCE ROW LEVEL SECURITY`;
  }

  await app.close();
  await sqlClient.end();
});

describe("Building — Cross-Tenant RLS Isolation", () => {
  let applicationId: string;

  it("Tenant A creates a building application", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/building/applications",
      headers: authA,
      payload: { siteAddress: { line1: "Tenant A HQ", city: "Test City", pin: "560001" }, plotArea: 400 },
    });
    expect(res.statusCode).toBe(202);
    applicationId = (res.json() as { id: string }).id;
    await queue.drain();

    // Sanity: Tenant A itself can read it back.
    const ownRead = await app.inject({ method: "GET", url: `/v1/building/applications/${applicationId}`, headers: authA });
    expect(ownRead.statusCode).toBe(200);
  });

  it("Tenant B GET by id returns 404, not the row or a 403", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/building/applications/${applicationId}`, headers: authB });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B's application list contains zero of Tenant A's data", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/building/applications", headers: authB });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string }>;
    expect(data.find((a) => a.id === applicationId)).toBeUndefined();
  });

  it("Tenant B cannot submit Tenant A's application (blocked at the pre-accept existence check, RLS-backed)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/building/applications/${applicationId}/submit`, headers: authB });
    expect(res.statusCode).toBe(404);
  });

  it("a permit issued under Tenant A is invisible to Tenant B", async () => {
    // Fast-track to 'approved' via direct fixture insert (this test's focus
    // is RLS on building_permits, not re-driving the full application
    // lifecycle already covered in applications/consumer.test.ts and
    // scrutiny/consumer.test.ts).
    const approvedAppId = randomUUID();
    await runWithTenant(TENANT_A, async () => {
      await db.transaction(async (tx) => {
        await applicationsRepo.insertApplication(tx, {
          id: approvedAppId,
          tenantId: TENANT_A,
          applicationNumber: `BLDG/RLS/${randomUUID().slice(0, 8)}`,
          status: "approved",
          siteAddress: { line1: "Tenant A permit site", city: "Test City", pin: "560001" },
          feeMinor: 500000n,
          feeCurrency: "INR",
          feePaid: true,
          createdBy: ACTOR_A,
          updatedBy: ACTOR_A,
        });
      });
    });

    const issueRes = await app.inject({
      method: "POST",
      url: "/v1/building/permits",
      headers: authA,
      payload: { applicationId: approvedAppId },
    });
    expect(issueRes.statusCode).toBe(202);
    const { id: permitId } = issueRes.json() as { id: string };
    await queue.drain();

    const bGet = await app.inject({ method: "GET", url: `/v1/building/permits/${permitId}`, headers: authB });
    expect(bGet.statusCode).toBe(404);

    const bList = await app.inject({ method: "GET", url: "/v1/building/permits", headers: authB });
    const data = bList.json().data as Array<{ id: string }>;
    expect(data.find((p) => p.id === permitId)).toBeUndefined();

    // Tenant B also cannot suspend Tenant A's permit — same RLS-backed 404.
    const bSuspend = await app.inject({
      method: "POST",
      url: `/v1/building/permits/${permitId}/suspend`,
      headers: authB,
      payload: { reason: "attempted cross-tenant suspend" },
    });
    expect(bSuspend.statusCode).toBe(404);
  });

  // Proves the isolation tests above genuinely rely on RLS, not just the
  // `WHERE tenantId = ctx.tenantId` clause every repo query already adds
  // (that clause alone would already 404 a cross-tenant GET with zero RLS
  // involvement, which is why the sabotage check below does NOT go through
  // the HTTP route/repo layer — it queries the table directly with no
  // application-level tenant filter at all, so the only thing that can
  // possibly be blocking the row is RLS itself).
  //
  // sqlClient authenticates as building_svc, the table's OWNER (confirmed:
  // `\dt building.*` reports Owner = building_svc). A table owner
  // unconditionally bypasses RLS unless FORCE ROW LEVEL SECURITY is set —
  // that flag exists precisely to bind the owner too. With no
  // app.tenant_id GUC set (this query runs outside runWithTenant, exactly
  // like a raw/ad-hoc query would), the tenant_isolation policy's
  // `current_setting('app.tenant_id', true)` is NULL and blocks every row —
  // so the initial "0 rows" result already IS RLS at work by default, not
  // an artifact of an empty result set.
  it("sabotage check: disabling RLS leaks a row through a raw, tenant-filter-free query (then RLS is restored)", async () => {
    const withRlsForced = await sqlClient`
      SELECT id FROM building.building_applications WHERE id = ${applicationId}
    `;
    expect(withRlsForced.length).toBe(0);

    // The DISABLE / verify-leak / ENABLE / FORCE sequence runs inside ONE
    // explicit DB transaction instead of four separate auto-committed
    // statements. That matters because plain auto-committed statements make
    // the DISABLE durable the instant it completes: if the process were torn
    // down anywhere after that point but before the matching ENABLE+FORCE
    // committed (e.g. a fork killed after a vitest test-timeout, which does
    // NOT cancel an in-flight query — it just stops waiting), the table is
    // left RLS-disabled for every other session, permanently, until someone
    // notices. Inside one transaction, the DISABLE is only ever visible to
    // this transaction until COMMIT — no other session can observe
    // building_applications with RLS off — and if anything errors or the
    // process dies mid-sequence, Postgres rolls the whole thing back and the
    // DISABLE simply never happened. `lock_timeout` bounds how long we wait
    // for the ACCESS EXCLUSIVE lock the ALTER TABLEs need, so a lock queued
    // behind another test file's open transaction fails fast (and rolls
    // back cleanly) instead of hanging indefinitely — belt-and-braces on top
    // of `fileParallelism: false` (vitest.config.ts), which is the primary
    // fix and should mean this table has no concurrent claimants at all.
    try {
      await sqlClient.begin(async (sql) => {
        await sql`SET LOCAL lock_timeout = '5s'`;
        await sql`ALTER TABLE building.building_applications DISABLE ROW LEVEL SECURITY`;

        const withRlsDisabled = await sql`
          SELECT id FROM building.building_applications WHERE id = ${applicationId}
        `;
        expect(withRlsDisabled.length).toBe(1);
        expect(withRlsDisabled[0]!.id).toBe(applicationId);

        await sql`ALTER TABLE building.building_applications ENABLE ROW LEVEL SECURITY`;
        await sql`ALTER TABLE building.building_applications FORCE ROW LEVEL SECURITY`;
      });
    } finally {
      // Fast-path safety net on top of the transaction's own all-or-nothing
      // guarantee: unconditionally re-assert the enabled+forced state
      // outside any transaction. Idempotent (a no-op if already
      // enabled+forced), so this costs nothing on the happy path — by the
      // time we get here the transaction above has already committed or
      // rolled back, so there is no lock contention left for these to wait
      // on. A second, suite-level safety net (querying pg_class directly)
      // also runs in this file's afterAll below.
      await sqlClient`ALTER TABLE building.building_applications ENABLE ROW LEVEL SECURITY`;
      await sqlClient`ALTER TABLE building.building_applications FORCE ROW LEVEL SECURITY`;
    }

    // Confirm the restore actually took: the same raw query is blocked again.
    const restored = await sqlClient`
      SELECT id FROM building.building_applications WHERE id = ${applicationId}
    `;
    expect(restored.length).toBe(0);

    // And the ordinary HTTP-level cross-tenant isolation (app filter + RLS
    // both intact) still holds too.
    const stillIsolated = await app.inject({ method: "GET", url: `/v1/building/applications/${applicationId}`, headers: authB });
    expect(stillIsolated.statusCode).toBe(404);
  });
});
