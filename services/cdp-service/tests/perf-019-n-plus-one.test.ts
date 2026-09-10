/**
 * PERF-019 regression test — cdp-service tranche.
 *
 * Covers the 1 cdp-service site named in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's PERF-019 row:
 *   - events/routes.ts POST /v1/cdp/events/batch (was N+1 — one
 *     profilesRepo.findById call PER event in the batch)
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring — wraps postgres-js's own `debug` hook), only counting
 * anything when DB_QUERY_DEBUG=true is set at test-run time (see
 * packages/db/src/pool.ts) — mirrors PERF-005 tranche 1's
 * perf-005-n-plus-one.test.ts files exactly. QUEUE_DRIVER=memory in this
 * service's vitest.config.ts (MemoryQueue is pure in-process Maps/Sets, no
 * DB calls — services/queue-service/src/bus.ts), so the per-event
 * commands.ingestEvent() write does NOT add Postgres round trips here: the
 * ONLY real queries this route makes in this test env are the profile
 * lookups, which is exactly the N+1 site being fixed. The primary assertion
 * is O(1)-not-O(N): the same route issues the SAME query count for a batch
 * of 3 events (3 distinct profiles) and a batch of 20 (20 distinct profiles).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { profiles } from "../src/modules/profiles/schema.js";
import { buildApp } from "../src/app.js";

const ACTOR = "b0000000-aaaa-4000-8000-000000000001";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const SMALL_N = 3;
const LARGE_N = 20;

function token(tenant: string) {
  return signToken({ sub: ACTOR, tid: tenant, roles: ["cdp_user", "super_admin"], sid: "perf019" }, SECRET);
}

async function seedProfiles(tenant: string, n: number) {
  const rows = Array.from({ length: n }, () => ({
    id: randomUUID(), tenantId: tenant, profileType: "individual" as const,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await runWithTenant(tenant, () => db.transaction(async (tx) => { await tx.insert(profiles).values(rows); }));
  return rows;
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => { await tx.delete(profiles).where(eq(profiles.tenantId, tenant)); }));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-019 — cdp-service N+1 fix", () => {
  it("POST /v1/cdp/events/batch: query count is O(1) not O(N) in distinct-profile count (was N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedProfiles(tenantSmall, SMALL_N);
    const large = await seedProfiles(tenantLarge, LARGE_N);

    const app = await buildApp();
    try {
      // One event per distinct profile, all transactional (no consent
      // category required per requiredConsent() in domain.ts), so every
      // event is accepted.
      const eventsFor = (rows: typeof small) => rows.map((p, i) => ({
        profileId: p.id, eventType: "order.created",
        payload: { i }, occurredAt: "2026-05-01T10:00:00.000Z",
      }));

      const { result: resSmall, queryCount: countSmall } = await countQueriesDuring(() =>
        app.inject({
          method: "POST", url: "/v1/cdp/events/batch",
          headers: { authorization: `Bearer ${token(tenantSmall)}`, "x-tenant-id": tenantSmall },
          payload: { events: eventsFor(small) },
        }));
      const { result: resLarge, queryCount: countLarge } = await countQueriesDuring(() =>
        app.inject({
          method: "POST", url: "/v1/cdp/events/batch",
          headers: { authorization: `Bearer ${token(tenantLarge)}`, "x-tenant-id": tenantLarge },
          payload: { events: eventsFor(large) },
        }));

      expect(resSmall.statusCode).toBe(202);
      expect(resLarge.statusCode).toBe(202);

      // O(1): identical round-trip count whether the batch touches 3
      // distinct profiles or 20. The old per-event findById loop would have
      // made ~17 more queries for the 20-event batch than the 3-event one.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(8);

      const bodySmall = resSmall.json() as { data: { accepted: number; rejected: number } };
      const bodyLarge = resLarge.json() as { data: { accepted: number; rejected: number } };
      expect(bodySmall.data).toMatchObject({ accepted: SMALL_N, rejected: 0 });
      expect(bodyLarge.data).toMatchObject({ accepted: LARGE_N, rejected: 0 });
    } finally {
      await app.close();
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });
});
