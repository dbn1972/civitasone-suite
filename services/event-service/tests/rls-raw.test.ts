/**
 * Direct-SQL proof that FORCE ROW LEVEL SECURITY on every event.* table is
 * what actually stops a cross-tenant leak — independent of and unaided by
 * every repo.ts function's own `eq(eventX.tenantId, tenantId)` WHERE clause
 * (see e.g. applications/repo.ts's findById). That app-level filter is real
 * defense-in-depth and every route test in this suite exercises it, but a
 * suite that only ever queries through those filtered repo functions cannot
 * tell a real RLS policy from a no-op one: TENANT_B's own request always
 * carries `tenantId = TENANT_B`, so it would exclude TENANT_A's rows even
 * if RLS silently did nothing at all.
 *
 * This file bypasses the repo layer entirely and issues a raw, UNFILTERED
 * `SELECT * FROM event.<table>` after setting only the `app.tenant_id`
 * session GUC the same way db.transaction() does (see @civitasone/db's
 * tenant-scope.ts) — mimicking the failure mode RLS actually guards
 * against: a future repo function that forgets its own tenant_id filter.
 * With FORCE ROW LEVEL SECURITY in place this must still return zero
 * cross-tenant rows purely from the policy.
 *
 * Verified to have real teeth (see the PR description's Verification
 * section for the transcript): with `ALTER TABLE event.<table>
 * NO FORCE ROW LEVEL SECURITY` temporarily applied in the isolated test
 * database (event_svc is the table OWNER, so without FORCE it bypasses RLS
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
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerNocConsumers } from "../src/modules/nocs/consumer.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { registerPostEventConsumers } from "../src/modules/post_event/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerNocConsumers(queue);
  registerPermitConsumers(queue);
  registerPostEventConsumers(queue);
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
    return tx.unsafe(`SELECT id, tenant_id FROM event.${table}`) as unknown as Promise<Array<{ id: string; tenant_id: string }>>;
  });
}

async function createApplicationForTenant(tenantId: string): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/event/applications",
    headers: hdr(ACTOR_A, tenantId),
    payload: {
      organiserName: "RLS Raw Test",
      organiserPhone: "9876500009",
      eventType: "sports",
      venueName: "RLS Ground",
      venueAddress: { line1: "1 RLS Rd", city: "Springfield", pin: "500001" },
      startDate: "2020-01-01",
      endDate: "2020-01-02",
      expectedAttendance: 80,
    },
  });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr(ACTOR_A, tenantId) })).statusCode === 200);
  return id;
}

describe("RLS — raw unfiltered query proof (bypasses app-level tenant filters)", () => {
  it("event_applications: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    const id = await createApplicationForTenant(TENANT_A);

    const asTenantA = await rawSelectAsTenant("event_applications", TENANT_A);
    expect(asTenantA.some((r) => r.id === id)).toBe(true);

    const asTenantB = await rawSelectAsTenant("event_applications", TENANT_B);
    expect(asTenantB.some((r) => r.id === id)).toBe(false);
  });

  it("event_noc_requests: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    const applicationId = await createApplicationForTenant(TENANT_A);
    const nocCreate = await app.inject({
      method: "POST",
      url: "/v1/event/nocs",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: { applicationId, department: "police" },
    });
    const nocId = (nocCreate.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr(ACTOR_A, TENANT_A) })).json().data.some((r: { id: string }) => r.id === nocId));

    const asTenantA = await rawSelectAsTenant("event_noc_requests", TENANT_A);
    expect(asTenantA.some((r) => r.id === nocId)).toBe(true);

    const asTenantB = await rawSelectAsTenant("event_noc_requests", TENANT_B);
    expect(asTenantB.some((r) => r.id === nocId)).toBe(false);
  });

  it("event_permits: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    const applicationId = await createApplicationForTenant(TENANT_A);
    await app.inject({ method: "POST", url: `/v1/event/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, TENANT_A) });
    await drainQueue();
    const nocCreate = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(ACTOR_A, TENANT_A), payload: { applicationId, department: "police" } });
    const nocId = (nocCreate.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr(ACTOR_A, TENANT_A) })).json().data.some((r: { id: string }) => r.id === nocId));
    await app.inject({ method: "POST", url: `/v1/event/nocs/${nocId}/respond`, headers: hdr(ACTOR_A, TENANT_A), payload: { status: "approved" } });
    await drainQueue();
    const issue = await app.inject({
      method: "POST",
      url: "/v1/event/permits",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: { applicationId, validFrom: "2020-01-01T00:00:00Z", validUntil: "2020-01-02T00:00:00Z" },
    });
    const permitId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const asTenantA = await rawSelectAsTenant("event_permits", TENANT_A);
    expect(asTenantA.some((r) => r.id === permitId)).toBe(true);

    const asTenantB = await rawSelectAsTenant("event_permits", TENANT_B);
    expect(asTenantB.some((r) => r.id === permitId)).toBe(false);
  });

  it("event_post_inspections: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    const applicationId = await createApplicationForTenant(TENANT_A);
    await app.inject({ method: "POST", url: `/v1/event/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, TENANT_A) });
    await drainQueue();
    const nocCreate = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(ACTOR_A, TENANT_A), payload: { applicationId, department: "police" } });
    const nocId = (nocCreate.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr(ACTOR_A, TENANT_A) })).json().data.some((r: { id: string }) => r.id === nocId));
    await app.inject({ method: "POST", url: `/v1/event/nocs/${nocId}/respond`, headers: hdr(ACTOR_A, TENANT_A), payload: { status: "approved" } });
    await drainQueue();
    const issue = await app.inject({
      method: "POST",
      url: "/v1/event/permits",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: { applicationId, validFrom: "2020-01-01T00:00:00Z", validUntil: "2020-01-02T00:00:00Z" },
    });
    const permitId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);
    const conduct = await app.inject({
      method: "POST",
      url: "/v1/event/post-inspections",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: { permitId, findings: {} },
    });
    const inspectionId = (conduct.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/post-inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const asTenantA = await rawSelectAsTenant("event_post_inspections", TENANT_A);
    expect(asTenantA.some((r) => r.id === inspectionId)).toBe(true);

    const asTenantB = await rawSelectAsTenant("event_post_inspections", TENANT_B);
    expect(asTenantB.some((r) => r.id === inspectionId)).toBe(false);
  });

  it("a session with NO app.tenant_id set at all sees zero rows from any table (fail-closed, not fail-open)", async () => {
    // No set_config call at all -- current_setting('app.tenant_id', true) is
    // NULL, and the policy's `tenant_id = NULLIF(current_setting(...), '')::uuid`
    // compares every row's tenant_id to NULL, which is never true. This is
    // the fail-closed behavior every tenant-scoped table in this service
    // relies on when a caller forgets to set the GUC at all (not just picks
    // the wrong tenant).
    await createApplicationForTenant(TENANT_A);
    const apps = await sqlClient.unsafe(`SELECT id FROM event.event_applications`);
    expect(apps.length).toBe(0);
    const permits = await sqlClient.unsafe(`SELECT id FROM event.event_permits`);
    expect(permits.length).toBe(0);
    const nocs = await sqlClient.unsafe(`SELECT id FROM event.event_noc_requests`);
    expect(nocs.length).toBe(0);
    const inspections = await sqlClient.unsafe(`SELECT id FROM event.event_post_inspections`);
    expect(inspections.length).toBe(0);
  });
});
