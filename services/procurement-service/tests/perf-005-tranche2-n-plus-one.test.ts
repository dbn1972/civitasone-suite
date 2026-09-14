/**
 * PERF-005 tranche 2 regression test — procurement-service.
 *
 * NOTE ON SCOPE: this site was NOT part of docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's
 * original PERF-005 file:line list (which named `grn/queries.ts:61` as
 * procurement-service's PERF-005 site — already fixed and closed under
 * PERF-019, see that row's Status). This is a newly-discovered N+1 found by
 * an independent codebase-wide grep for the same anti-pattern (a `.map(async
 * ...)` doing a per-row DB call after an initial list/detail query), in a
 * different module (rfq, not grn) of the same service. See this tranche's PR
 * description for the full list of newly-discovered sites and why they are
 * tracked here rather than under the original PERF-005/PERF-019 entries.
 *
 * Covers:
 *   - rfq/queries.ts::getRfqDetail (was N+1 via vendorRepo.findVendorById per response row)
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring — wraps postgres-js's own `debug` hook), only counting
 * anything when DB_QUERY_DEBUG=true is set at test-run time (see
 * packages/db/src/pool.ts) — mirrors PERF-005/PERF-019's own test files
 * exactly. The primary assertion is O(1)-not-O(N): the same function issues
 * the SAME query count for a small (3-response) RFQ and a large (20-response)
 * one.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementRfqs, procurementRfqItems, procurementRfqResponses } from "../src/modules/rfq/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { getRfqDetail } from "../src/modules/rfq/queries.js";

const ACTOR = "70000000-aaaa-4000-8000-000000000001";
const SMALL_N = 3;
const LARGE_N = 20;

async function seedRfqWithResponses(tenant: string, n: number, tag = "") {
  const rfqId = randomUUID();
  const rfq = {
    // tag disambiguates rfq_no when seeding more than one RFQ for the same
    // tenant (e.g. a warm-up RFQ alongside the tenant's "real" measured
    // one) -- rfq_no has a UNIQUE(tenant_id, rfq_no) constraint
    // (migrations/0003_rfq_tender.sql), and this helper's rfqNo would
    // otherwise depend only on the tenant, colliding across two calls for
    // the same tenant.
    id: rfqId, tenantId: tenant, rfqNo: `PERF005T2-RFQ-${tenant.slice(0, 8)}${tag}`,
    title: "PERF-005 tranche 2 test RFQ", vendorsInvited: n, responsesReceived: n,
    closingDate: "2026-04-01", status: "issued", createdBy: ACTOR, updatedBy: ACTOR,
  };
  const vendors = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(), tenantId: tenant, name: `Vendor ${i}`,
    vendorType: "registered", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  const responses = vendors.map((v, i) => ({
    id: randomUUID(), tenantId: tenant, rfqId, vendorId: v.id,
    items: [], totalAmountMinor: BigInt(100000 + i), termsAccepted: true,
    status: "submitted", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(procurementRfqs).values(rfq);
    await tx.insert(procurementVendors).values(vendors);
    await tx.insert(procurementRfqResponses).values(responses);
  }));
  return { rfqId, vendors, responses };
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(procurementRfqResponses).where(eq(procurementRfqResponses.tenantId, tenant));
    await tx.delete(procurementRfqItems).where(eq(procurementRfqItems.tenantId, tenant));
    await tx.delete(procurementRfqs).where(eq(procurementRfqs.tenantId, tenant));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, tenant));
  }));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-005 tranche 2 — procurement-service N+1 fix", () => {
  it("getRfqDetail: query count is O(1) not O(N), each response's vendorName resolves correctly (was N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedRfqWithResponses(tenantSmall, SMALL_N);
    const large = await seedRfqWithResponses(tenantLarge, LARGE_N);
    try {
      // Warm-up (untimed): postgres-js resolves the element-type OID for an
      // array-bound parameter (inArray(ids) in vendorRepo.findVendorsByIds)
      // lazily on its first use per process/connection, as an extra round
      // trip that would otherwise land arbitrarily on whichever of the two
      // MEASURED calls below happens to run first and break the O(1)
      // comparison (see estab-service's sibling perf-005-tranche2 test for
      // the fuller writeup of this class of bug).
      //
      // Unlike court/admin's warm-ups, this one must NOT reuse either
      // measured rfqId: getRfqDetail's own RFQ-row read is itself
      // cache.getOrLoad()-cached, keyed on `${tenantId}:rfq:${id}` (see
      // queries.ts). Warming up against small.rfqId or large.rfqId would
      // silently prime THAT exact cache entry and give the matching
      // measured call a free cache hit the other one doesn't get -- the
      // same deterministic asymmetry (not a flake) found and fixed in
      // estab-service's test, there caused by reusing a limit instead of an
      // id. A third, disposable RFQ under tenantSmall (different id, so a
      // different cache key; wipe(tenantSmall) below already deletes it,
      // no extra cleanup needed) sidesteps this entirely while still using
      // real seeded rows so findVendorsByIds's inArray() actually executes.
      const warmup = await seedRfqWithResponses(tenantSmall, 1, "-WARMUP");
      await runWithTenant(tenantSmall, () => getRfqDetail(warmup.rfqId, tenantSmall));

      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => getRfqDetail(small.rfqId, tenantSmall)));
      const { result: detail, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => getRfqDetail(large.rfqId, tenantLarge)));

      // O(1): identical round-trip count whether the RFQ has 3 responses or
      // 20. The old per-response findVendorById loop would have made ~17
      // more queries for the 20-response RFQ than the 3-response one.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      expect(detail).not.toBeNull();
      expect(detail!.responses).toHaveLength(LARGE_N);
      const vendorNameById = new Map(large.vendors.map((v) => [v.id, v.name]));
      for (const response of detail!.responses) {
        expect(response.vendorName).toBe(vendorNameById.get(response.vendorId));
        // A resolved name must never fall back to the raw id.
        expect(response.vendorName).not.toBe(response.vendorId);
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });

  it("getRfqDetail: an unknown vendorId still falls back to the raw id (batch loader returns a partial Map, not an error)", async () => {
    const tenant = randomUUID();
    const rfqId = randomUUID();
    const ghostVendorId = randomUUID(); // never inserted into procurement_vendors
    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.insert(procurementRfqs).values({
        id: rfqId, tenantId: tenant, rfqNo: "PERF005T2-RFQ-GHOST", title: "Ghost vendor test",
        vendorsInvited: 1, responsesReceived: 1, closingDate: "2026-04-01",
        status: "issued", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(procurementRfqResponses).values({
        id: randomUUID(), tenantId: tenant, rfqId, vendorId: ghostVendorId,
        items: [], totalAmountMinor: 5000n, termsAccepted: true, status: "submitted",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    try {
      const detail = await runWithTenant(tenant, () => getRfqDetail(rfqId, tenant));
      expect(detail!.responses).toHaveLength(1);
      expect(detail!.responses[0]!.vendorName).toBe(ghostVendorId);
    } finally {
      await wipe(tenant);
    }
  });
});
