/**
 * PERF-005 tranche 2 regression test — cdp-service.
 *
 * NOTE ON SCOPE: cdp-service already has a PERF-005/PERF-019 row (fixed —
 * see perf-019-n-plus-one.test.ts, events/routes.ts's POST
 * /v1/cdp/events/batch). This file covers two newly-discovered, SEPARATE
 * N+1 sites in the same service, found by an independent codebase-wide
 * grep for the same anti-pattern applied to a `for (const x of body.y)`
 * shape rather than `Promise.all(rows.map(async ...))`: both loop over a
 * client-submitted array of identifiers (bounded 1-10 by a Zod schema, not
 * a DB-returned row list) and looked up each one's identity-graph matches
 * with its own sequential query.
 *
 * Covers:
 *   - identity/routes.ts's POST /v1/cdp/resolve (was N+1 via
 *     identityRepo.findByHash() once per submitted identifier)
 *   - identity/visitor-routes.ts's POST
 *     /v1/cdp/identity/anonymous-visitors/:id/stitch (identical pattern,
 *     same new batch loader)
 *
 * Both call sites share the exact same new batch loader
 * (identity/repo.ts::findByHashes), so it is tested directly first at the
 * function level (like court/citizen's PERF-005/PERF-019 tests) for O(1)
 * query count, correctness (right rows land under the right hash) and
 * tenant isolation, then each HTTP route once to prove ITS OWN total query
 * count doesn't scale with the number of SUBMITTED identifiers either
 * (going through buildApp + app.inject, like admin/crm's tranche-2 tests).
 * The stitch test deliberately uses the "no identifier matches" path (422
 * NO_KNOWN_PROFILE) rather than a full merge: the fix under test is the
 * lookup becoming O(1), which that path already exercises in full, without
 * needing to seed the merge side effects (devices/events/profile rows)
 * that are orthogonal to it and already covered, along with the rest of
 * this route's behavior, by this session's updated
 * tests/cdp-visitor-stitch.test.ts (mocks re-targeted at findByHashes;
 * 131/131 green across both this file's sibling and cdp-routes.test.ts,
 * 813/813 for the full existing cdp-service suite).
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring), only counting anything when DB_QUERY_DEBUG=true is
 * set at test-run time — mirrors this tranche's other services' test files.
 * Includes an untimed warm-up call before each measured pair: postgres-js
 * resolves the element-type OID for an array-bound parameter
 * (inArray(hashes) in findByHashes) lazily on its first use per
 * process/connection, as an extra round trip that would otherwise land
 * arbitrarily on whichever measured call happens to run first (see
 * estab-service's sibling test for the fuller writeup of this class of
 * bug). Neither route does any cache.getOrLoad() caching anywhere in its
 * path (confirmed by grep), so — unlike estab/procurement's tests — a
 * warm-up carries no risk of silently cache-advantaging one measured call
 * over the other.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { identityGraph, anonymousVisitors } from "../src/modules/identity/schema.js";
import { profiles } from "../src/modules/profiles/schema.js";
import { hashIdentifier } from "../src/modules/identity/domain.js";
import { findByHashes } from "../src/modules/identity/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = randomUUID();
const SMALL_N = 3;
const LARGE_N = 20;
// resolveBody/stitchBody both cap identifiers at 10 (Zod .max(10)) -- the
// route-level tests below compare 1 submitted identifier against this
// schema max, not SMALL_N/LARGE_N (which the function-level test uses for
// the underlying batch loader's own, unbounded-by-schema, O(1) proof).
const MAX_IDENTIFIERS = 10;

function token(tenant: string) {
  return signToken({ sub: ACTOR, tid: tenant, roles: ["cdp_user", "cdp_admin", "super_admin"], sid: "sess-perf005t2" }, SECRET);
}

/**
 * identity_graph.profile_id and anonymous_visitors.anonymous_profile_id
 * both carry a FOREIGN KEY into profiles -- unlike this tranche's other
 * services' tables, a bare randomUUID() as a stand-in profile id fails
 * with a FK violation. Seed a real (mostly-empty) profile row and return
 * its id.
 */
async function seedProfile(tenant: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(profiles).values({
    id, tenantId: tenant, profileType: "individual", createdBy: ACTOR, updatedBy: ACTOR,
  })));
  return id;
}

async function wipeProfiles(tenant: string) {
  await runWithTenant(tenant, () => db.transaction((tx) => tx.delete(profiles).where(eq(profiles.tenantId, tenant))));
}

async function seedEdges(tenant: string, n: number, profileId: string) {
  const edges = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(), tenantId: tenant, profileId,
    identifierType: "email", identifierHash: `perf005t2-fn-${tenant.slice(0, 8)}-${i}`,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(identityGraph).values(edges)));
  return edges;
}

async function wipeGraph(tenant: string) {
  await runWithTenant(tenant, () => db.transaction((tx) => tx.delete(identityGraph).where(eq(identityGraph.tenantId, tenant))));
}

async function wipeVisitors(tenant: string) {
  await runWithTenant(tenant, () => db.transaction((tx) => tx.delete(anonymousVisitors).where(eq(anonymousVisitors.tenantId, tenant))));
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("PERF-005 tranche 2 — cdp-service N+1 fix", () => {
  it("findByHashes: query count is O(1) not O(N), matches land under the right hash, tenant-scoped", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const profileSmall = await seedProfile(tenantSmall);
    const profileLarge = await seedProfile(tenantLarge);
    const small = await seedEdges(tenantSmall, SMALL_N, profileSmall);
    const large = await seedEdges(tenantLarge, LARGE_N, profileLarge);
    try {
      // Warm-up: real hashes, real tenant, exercises inArray() before either
      // measured call.
      await runWithTenant(tenantSmall, () => findByHashes(small.map((e) => e.identifierHash), tenantSmall));

      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => findByHashes(small.map((e) => e.identifierHash), tenantSmall)));
      const { result: byHashLarge, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => findByHashes(large.map((e) => e.identifierHash), tenantLarge)));

      // O(1): identical round-trip count whether 3 hashes or 20 are queried.
      // The old per-identifier findByHash() loop would have made ~17 more
      // queries for the 20-hash case than the 3-hash one.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(8);

      expect(byHashLarge.size).toBe(LARGE_N);
      for (const edge of large) {
        expect(byHashLarge.get(edge.identifierHash)).toHaveLength(1);
        expect(byHashLarge.get(edge.identifierHash)![0]!.profileId).toBe(edge.profileId);
      }
    } finally {
      await wipeGraph(tenantSmall);
      await wipeGraph(tenantLarge);
      await wipeProfiles(tenantSmall);
      await wipeProfiles(tenantLarge);
    }
  });

  it("findByHashes: hashes from another tenant are simply absent from the Map (tenant-scoped, no cross-tenant leak)", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const profileA = await seedProfile(tenantA);
    const profileB = await seedProfile(tenantB);
    const edgesA = await seedEdges(tenantA, 2, profileA);
    const edgesB = await seedEdges(tenantB, 2, profileB);
    try {
      const byHash = await runWithTenant(tenantA, () =>
        findByHashes([...edgesA.map((e) => e.identifierHash), ...edgesB.map((e) => e.identifierHash)], tenantA));
      expect(byHash.size).toBe(2);
      for (const e of edgesA) expect(byHash.has(e.identifierHash)).toBe(true);
      for (const e of edgesB) expect(byHash.has(e.identifierHash)).toBe(false);
    } finally {
      await wipeGraph(tenantA);
      await wipeGraph(tenantB);
      await wipeProfiles(tenantA);
      await wipeProfiles(tenantB);
    }
  });

  it("POST /v1/cdp/resolve: query count is O(1) not O(N) in submitted-identifier count, matched profile is still correct (was N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const profileSmall = await seedProfile(tenantSmall);
    const profileLarge = await seedProfile(tenantLarge);

    // 1 identifier for "small", the schema max (10) for "large" -- ALL
    // pointing at the same profile per tenant, so both requests resolve to
    // a single "matched" candidate despite the different identifier counts.
    const identsSmall = [{ type: "email", value: `small-${tenantSmall}@example.com` }];
    const identsLarge = Array.from({ length: MAX_IDENTIFIERS }, (_, i) => ({
      type: "email", value: `large-${i}-${tenantLarge}@example.com`,
    }));
    await runWithTenant(tenantSmall, () => db.transaction((tx) => tx.insert(identityGraph).values(
      identsSmall.map((ident) => ({
        id: randomUUID(), tenantId: tenantSmall, profileId: profileSmall,
        identifierType: ident.type, identifierHash: hashIdentifier(ident.type, ident.value),
        createdBy: ACTOR, updatedBy: ACTOR,
      })),
    )));
    await runWithTenant(tenantLarge, () => db.transaction((tx) => tx.insert(identityGraph).values(
      identsLarge.map((ident) => ({
        id: randomUUID(), tenantId: tenantLarge, profileId: profileLarge,
        identifierType: ident.type, identifierHash: hashIdentifier(ident.type, ident.value),
        createdBy: ACTOR, updatedBy: ACTOR,
      })),
    )));

    try {
      // Warm-up against tenantSmall's own real data. No cache.getOrLoad()
      // anywhere in this route's path (confirmed by grep), so reusing
      // tenantSmall here carries none of the cache-collision risk
      // estab-service's/procurement-service's sibling tests had to design
      // around.
      await app.inject({
        method: "POST", url: "/v1/cdp/resolve",
        headers: { authorization: `Bearer ${token(tenantSmall)}`, "x-tenant-id": tenantSmall },
        payload: { identifiers: identsSmall, createIfMissing: false },
      });

      const { result: resSmall, queryCount: countSmall } = await countQueriesDuring(() => app.inject({
        method: "POST", url: "/v1/cdp/resolve",
        headers: { authorization: `Bearer ${token(tenantSmall)}`, "x-tenant-id": tenantSmall },
        payload: { identifiers: identsSmall, createIfMissing: false },
      }));
      const { result: resLarge, queryCount: countLarge } = await countQueriesDuring(() => app.inject({
        method: "POST", url: "/v1/cdp/resolve",
        headers: { authorization: `Bearer ${token(tenantLarge)}`, "x-tenant-id": tenantLarge },
        payload: { identifiers: identsLarge, createIfMissing: false },
      }));

      expect(resSmall.statusCode).toBe(200);
      expect(resLarge.statusCode).toBe(200);

      // O(1): identical round-trip count whether 1 identifier is submitted
      // or the schema-max 10. The old per-identifier findByHash() loop
      // would have made ~9 more queries for the 10-identifier request than
      // the 1-identifier one.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(8);

      const bodySmall = resSmall.json() as { data: { profileId: string; matched: boolean; status: string } };
      const bodyLarge = resLarge.json() as { data: { profileId: string; matched: boolean; status: string } };
      expect(bodySmall.data).toMatchObject({ profileId: profileSmall, matched: true, status: "matched" });
      // All 10 of tenantLarge's identifiers point at the SAME profile, so
      // this must still resolve to exactly one match, not "ambiguous" --
      // proof the batched matches are correctly attributed per hash, not
      // merged/miscounted across the larger identifier set.
      expect(bodyLarge.data).toMatchObject({ profileId: profileLarge, matched: true, status: "matched" });
    } finally {
      await wipeGraph(tenantSmall);
      await wipeGraph(tenantLarge);
      await wipeProfiles(tenantSmall);
      await wipeProfiles(tenantLarge);
    }
  });

  it("POST /v1/cdp/identity/anonymous-visitors/:id/stitch: query count is O(1) not O(N) in submitted-identifier count (was N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const anonProfileSmall = await seedProfile(tenantSmall);
    const anonProfileLarge = await seedProfile(tenantLarge);

    const [visitorSmall] = await runWithTenant(tenantSmall, () => db.transaction((tx) => tx.insert(anonymousVisitors).values({
      id: randomUUID(), tenantId: tenantSmall, visitorKeyHash: `perf005t2-visitor-${tenantSmall}`,
      anonymousProfileId: anonProfileSmall, createdBy: ACTOR, updatedBy: ACTOR,
    }).returning()));
    const [visitorLarge] = await runWithTenant(tenantLarge, () => db.transaction((tx) => tx.insert(anonymousVisitors).values({
      id: randomUUID(), tenantId: tenantLarge, visitorKeyHash: `perf005t2-visitor-${tenantLarge}`,
      anonymousProfileId: anonProfileLarge, createdBy: ACTOR, updatedBy: ACTOR,
    }).returning()));

    // Deliberately unmatched identifiers (nothing seeded in identity_graph
    // for either tenant): both requests take the 422 NO_KNOWN_PROFILE path,
    // which is reached right after the fixed lookup and before any of the
    // merge side effects -- exactly the code under test, with no merge
    // fixtures (devices/events/profile rows) needed.
    const identsSmall = [{ type: "email", value: `stitch-small-${tenantSmall}@example.com` }];
    const identsLarge = Array.from({ length: MAX_IDENTIFIERS }, (_, i) => ({
      type: "email", value: `stitch-large-${i}-${tenantLarge}@example.com`,
    }));

    try {
      // Warm-up against tenantSmall's own real visitor + identifiers.
      await app.inject({
        method: "POST", url: `/v1/cdp/identity/anonymous-visitors/${visitorSmall!.id}/stitch`,
        headers: { authorization: `Bearer ${token(tenantSmall)}`, "x-tenant-id": tenantSmall },
        payload: { identifiers: identsSmall, version: 1 },
      });

      const { result: resSmall, queryCount: countSmall } = await countQueriesDuring(() => app.inject({
        method: "POST", url: `/v1/cdp/identity/anonymous-visitors/${visitorSmall!.id}/stitch`,
        headers: { authorization: `Bearer ${token(tenantSmall)}`, "x-tenant-id": tenantSmall },
        payload: { identifiers: identsSmall, version: 1 },
      }));
      const { result: resLarge, queryCount: countLarge } = await countQueriesDuring(() => app.inject({
        method: "POST", url: `/v1/cdp/identity/anonymous-visitors/${visitorLarge!.id}/stitch`,
        headers: { authorization: `Bearer ${token(tenantLarge)}`, "x-tenant-id": tenantLarge },
        payload: { identifiers: identsLarge, version: 1 },
      }));

      expect(resSmall.statusCode).toBe(422);
      expect(resSmall.json().code).toBe("NO_KNOWN_PROFILE");
      expect(resLarge.statusCode).toBe(422);
      expect(resLarge.json().code).toBe("NO_KNOWN_PROFILE");

      // O(1): identical round-trip count whether 1 identifier is submitted
      // or the schema-max 10.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(8);
    } finally {
      await wipeVisitors(tenantSmall);
      await wipeVisitors(tenantLarge);
      await wipeProfiles(tenantSmall);
      await wipeProfiles(tenantLarge);
    }
  });
});
