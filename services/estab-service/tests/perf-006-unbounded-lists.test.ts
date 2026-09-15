/**
 * PERF-006 regression test — estab-service.
 *
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's PERF-006 row names
 * `booking/queries.ts:34` and `citizen-lease/queries.ts:10,25,45` (routes
 * `booking/routes.ts:111`, `citizen-lease/routes.ts:72,96,136`): each was a
 * plain `db.select().from(table).where(eq(table.tenantId, tenantId))` with
 * no `.limit()`/`.offset()` at all, so the whole tenant's rows came back in
 * one unbounded query no matter how many bookings/properties/leases/requests
 * had accumulated. `listFacilities` had the identical pattern in the same
 * file as `listBookings` and is fixed and covered here too, though facility
 * *catalogues* (physical halls/grounds) are a much smaller, lower-risk table
 * than booking *history*.
 *
 * Unlike PERF-005/019/021/024 (this campaign's N+1 fixes, which count
 * queries via `countQueriesDuring`), the bug here is a single query with no
 * row cap -- so the regression to prove is result-set SIZE, not query COUNT:
 * walk every function page by page with a small pageSize against a tenant
 * seeded with 2.5x that many rows, and assert (a) no single page ever
 * exceeds pageSize regardless of how many rows exist underneath, (b) paging
 * through recovers every seeded row (no data loss from the fix), and (c) it
 * genuinely took more than one page (i.e. the old code really would have
 * returned everything in one shot here).
 *
 * Tested at the queries.ts function level directly (same convention as
 * tests/perf-005-tranche2-n-plus-one.test.ts in this service).
 *
 * SKIPPED (describe.skip): confirmed against a real, freshly-migrated
 * civitas_estab database that neither the `booking` nor `citizen_lease`
 * Postgres schema exists anywhere -- `grep -rn "booking\|citizen_lease"
 * services/estab-service/migrations/*.sql` only matches unrelated tables
 * (assets.estab_vehicle_bookings, facilities.estab_room_bookings); no
 * migration ever created these two modules' tables, and shared/db.ts's
 * ESTAB_SCHEMA doesn't import either module's schema.ts either. Running
 * this suite unskipped fails all 5 cases with
 * `relation "booking.estab_bookings" does not exist` (and the citizen_lease
 * equivalents) -- a pre-existing gap unrelated to PERF-006, not something
 * this fix caused or can fix by itself (writing a correct migration for 7
 * tables, indexes, and this codebase's RLS conventions is a materially
 * different, larger piece of work). The code fix above is still correct by
 * inspection and matches the pagination convention used everywhere else in
 * this fix -- un-skip this file once that migration lands.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFacilitiesCatalog, estabBookings } from "../src/modules/booking/schema.js";
import { estabLeaseProperties, estabLeases, estabLeaseRequests } from "../src/modules/citizen-lease/schema.js";
import * as bookingQueries from "../src/modules/booking/queries.js";
import * as leaseQueries from "../src/modules/citizen-lease/queries.js";

const ACTOR = "60000000-bbbb-4000-8000-000000000001";
const PAGE_SIZE = 10;
const TOTAL = 25; // 2.5x PAGE_SIZE -- forces 3 pages (10 + 10 + 5)

interface Page<T> { data: T[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }

/**
 * Walks `list` page by page (starting at offset 0) until `hasMore` is false.
 * Proves the fix regardless of how many rows the underlying table holds:
 * every single page is capped at `pageSize`, yet walking all pages still
 * recovers exactly `totalSeeded` rows, and it took more than one page to do
 * it (otherwise the test would be vacuously true even for unbounded code).
 */
async function assertBoundedPagination<T>(
  list: (limit: number, offset: number) => Promise<Page<T>>,
  totalSeeded: number,
  pageSize: number,
): Promise<void> {
  const seen: T[] = [];
  let offset = 0;
  let pages = 0;
  for (;;) {
    const page = await list(pageSize, offset);
    expect(page.data.length).toBeLessThanOrEqual(pageSize);
    expect(page.pagination.pageSize).toBe(pageSize);
    seen.push(...page.data);
    pages++;
    if (!page.pagination.hasMore) break;
    expect(page.data.length).toBe(pageSize); // hasMore=true only makes sense for a full page
    offset += page.data.length;
    if (pages > 20) throw new Error("pagination never terminated -- possible bug in the fix or this test");
  }
  expect(seen).toHaveLength(totalSeeded);
  expect(pages).toBeGreaterThan(1);
}

afterAll(async () => { await sqlClient.end(); });

describe.skip("PERF-006 — estab-service unbounded tenant-wide list queries", () => {
  it("listBookings: bounded page regardless of how many bookings the tenant has", async () => {
    const tenant = randomUUID();
    const facilityId = randomUUID();
    const rows = Array.from({ length: TOTAL }, (_, i) => ({
      tenantId: tenant, bookingNumber: `BK-${i}`, facilityId,
      applicantName: `Applicant ${i}`, applicantPhone: "9999999999",
      eventDate: "2026-01-01", startTime: "10:00", endTime: "12:00",
      createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await db.insert(estabBookings).values(rows);
    try {
      await assertBoundedPagination(
        (limit, offset) => bookingQueries.listBookings(tenant, {}, limit, offset),
        TOTAL, PAGE_SIZE,
      );
    } finally {
      await db.delete(estabBookings).where(eq(estabBookings.tenantId, tenant));
    }
  });

  it("listFacilities: bounded page regardless of how many facilities the tenant has", async () => {
    const tenant = randomUUID();
    const rows = Array.from({ length: TOTAL }, (_, i) => ({
      tenantId: tenant, facilityName: `Hall ${i}`, facilityType: "community_hall",
      createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await db.insert(estabFacilitiesCatalog).values(rows);
    try {
      await assertBoundedPagination(
        (limit, offset) => bookingQueries.listFacilities(tenant, {}, limit, offset),
        TOTAL, PAGE_SIZE,
      );
    } finally {
      await db.delete(estabFacilitiesCatalog).where(eq(estabFacilitiesCatalog.tenantId, tenant));
    }
  });

  it("listProperties: bounded page regardless of how many lease properties the tenant has", async () => {
    const tenant = randomUUID();
    const rows = Array.from({ length: TOTAL }, (_, i) => ({
      tenantId: tenant, propertyCode: `PROP-${tenant.slice(0, 8)}-${i}`, propertyType: "shop",
      monthlyRentMinor: 50000n, createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await db.insert(estabLeaseProperties).values(rows);
    try {
      await assertBoundedPagination(
        (limit, offset) => leaseQueries.listProperties(tenant, {}, limit, offset),
        TOTAL, PAGE_SIZE,
      );
    } finally {
      await db.delete(estabLeaseProperties).where(eq(estabLeaseProperties.tenantId, tenant));
    }
  });

  it("listLeases: bounded page regardless of how many leases the tenant has", async () => {
    const tenant = randomUUID();
    const propertyId = randomUUID();
    const rows = Array.from({ length: TOTAL }, (_, i) => ({
      tenantId: tenant, leaseNumber: `LEASE-${i}`, propertyId,
      tenantName: `Tenant ${i}`, tenantPhone: "9999999999",
      leaseStartDate: "2026-01-01", leaseEndDate: "2027-01-01",
      monthlyRentMinor: 50000n, createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await db.insert(estabLeases).values(rows);
    try {
      await assertBoundedPagination(
        (limit, offset) => leaseQueries.listLeases(tenant, {}, limit, offset),
        TOTAL, PAGE_SIZE,
      );
    } finally {
      await db.delete(estabLeases).where(eq(estabLeases.tenantId, tenant));
    }
  });

  it("listRequests: bounded page regardless of how many lease requests the tenant has", async () => {
    const tenant = randomUUID();
    const leaseId = randomUUID();
    const rows = Array.from({ length: TOTAL }, (_, i) => ({
      tenantId: tenant, leaseId, requestType: "renewal", requestNumber: `REQ-${i}`,
      requestedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await db.insert(estabLeaseRequests).values(rows);
    try {
      await assertBoundedPagination(
        (limit, offset) => leaseQueries.listRequests(tenant, {}, limit, offset),
        TOTAL, PAGE_SIZE,
      );
    } finally {
      await db.delete(estabLeaseRequests).where(eq(estabLeaseRequests.tenantId, tenant));
    }
  });
});
