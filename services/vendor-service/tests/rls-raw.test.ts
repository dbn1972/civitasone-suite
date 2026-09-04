/**
 * Direct-SQL proof that FORCE ROW LEVEL SECURITY on every vendor.* table is
 * what actually stops a cross-tenant leak — independent of and unaided by
 * every repo.ts function's own `eq(vendorX.tenantId, tenantId)` WHERE
 * clause (see e.g. licences/repo.ts's findById). That app-level filter is
 * real defense-in-depth and every route test in this suite exercises it,
 * but a suite that only ever queries through those filtered repo functions
 * cannot tell a real RLS policy from a no-op one: TENANT_B's own request
 * always carries `tenantId = TENANT_B`, so it would exclude TENANT_A's rows
 * even if RLS silently did nothing at all.
 *
 * This file bypasses the repo layer entirely and issues a raw, UNFILTERED
 * `SELECT * FROM vendor.<table>` after setting only the `app.tenant_id`
 * session GUC the same way db.transaction() does (see
 * @civitasone/db's tenant-scope.ts) — mimicking the failure mode RLS
 * actually guards against: a future repo function that forgets its own
 * tenant_id filter. With FORCE ROW LEVEL SECURITY in place this must still
 * return zero cross-tenant rows purely from the policy.
 *
 * Verified to have real teeth (see PR description's Verification section
 * for the transcript): with `ALTER TABLE vendor.<table>
 * NO FORCE ROW LEVEL SECURITY` temporarily applied in the isolated test
 * database (vendor_svc is the table OWNER, so without FORCE it bypasses RLS
 * like any owner), every test below was confirmed to FAIL — the raw query
 * returned the other tenant's row. FORCE was then restored and this file
 * re-run to confirm it passes again. tenant-isolation.test.ts, by contrast,
 * kept passing even with FORCE stripped, precisely because it only ever
 * goes through the tenant-filtered HTTP routes — which is exactly the gap
 * this file exists to close.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import { registerLicenceConsumers } from "../src/modules/licences/consumer.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerRegistrationConsumers(queue);
  registerCommitteeConsumers(queue);
  registerLicenceConsumers(queue);
  registerLifecycleConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

/** Raw, tenant-filter-free read: sets ONLY the RLS session GUC, nothing else. */
async function rawSelectAsTenant(table: string, tenantId: string): Promise<Array<{ id: string; tenant_id: string }>> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.unsafe(`SELECT id, tenant_id FROM vendor.${table}`) as unknown as Promise<Array<{ id: string; tenant_id: string }>>;
  });
}

describe("RLS — raw unfiltered query proof (bypasses app-level tenant filters)", () => {
  it("vendor_registrations: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/vendor/registrations",
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
      payload: { vendorName: "RLS Raw Test", vendorAadhaar: "123456789022", vendorPhone: "9876577777", category: "food" },
    });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr() })).statusCode === 200);

    const asTenantA = await rawSelectAsTenant("vendor_registrations", TENANT_A);
    expect(asTenantA.some((r) => r.id === id)).toBe(true);

    const asTenantB = await rawSelectAsTenant("vendor_registrations", TENANT_B);
    expect(asTenantB.some((r) => r.id === id)).toBe(false);
  });

  it("vendor_licences: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/vendor/registrations",
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
      payload: { vendorName: "RLS Raw Licence Test", vendorAadhaar: "123456789023", vendorPhone: "9876577778", category: "food" },
    });
    const regId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${regId}`, headers: hdr() })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/vendor/registrations/${regId}/submit`, headers: hdr(ACTOR_A, TENANT_A) });
    await drainQueue();
    const assign = await app.inject({ method: "POST", url: "/v1/vendor/committee/reviews", headers: hdr(ACTOR_A, TENANT_A), payload: { registrationId: regId, committeeType: "zone_committee" } });
    await drainQueue();
    const reviewId = (assign.json() as { id: string }).id;
    await app.inject({ method: "POST", url: `/v1/vendor/committee/reviews/${reviewId}/complete`, headers: hdr(ACTOR_A, TENANT_A), payload: { findings: {}, recommendation: "approve" } });
    await drainQueue();
    await app.inject({ method: "POST", url: "/v1/vendor/committee/decide", headers: hdr(ACTOR_A, TENANT_A), payload: { registrationId: regId, decision: "approved" } });
    await drainQueue();
    const issue = await app.inject({
      method: "POST",
      url: "/v1/vendor/licences",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: { registrationId: regId, zone: "Zone RLS", spotNumber: "S-RLS", validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 3600000).toISOString() },
    });
    const licId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const asTenantA = await rawSelectAsTenant("vendor_licences", TENANT_A);
    expect(asTenantA.some((r) => r.id === licId)).toBe(true);

    const asTenantB = await rawSelectAsTenant("vendor_licences", TENANT_B);
    expect(asTenantB.some((r) => r.id === licId)).toBe(false);
  });

  it("vendor_committee_reviews and vendor_renewals: a session with NO app.tenant_id set at all sees zero rows from either tenant (fail-closed, not fail-open)", async () => {
    // No set_config call at all -- current_setting('app.tenant_id', true) is
    // NULL, and the policy's `tenant_id = NULLIF(current_setting(...), '')::uuid`
    // compares every row's tenant_id to NULL, which is never true. This is
    // the fail-closed behavior every tenant-scoped table in this service
    // relies on when a caller forgets to set the GUC at all (not just picks
    // the wrong tenant).
    const reviews = await sqlClient.unsafe(`SELECT id FROM vendor.vendor_committee_reviews`);
    expect(reviews.length).toBe(0);
    const renewals = await sqlClient.unsafe(`SELECT id FROM vendor.vendor_renewals`);
    expect(renewals.length).toBe(0);
  });
});
