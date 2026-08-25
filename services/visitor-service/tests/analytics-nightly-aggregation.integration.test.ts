/**
 * DPDP/analytics — nightly aggregation correctness + tenant isolation.
 *
 * Two independent, confirmed bugs in analytics/nightly-aggregation-worker.ts,
 * found by building one hand-verifiable visit (known 2h duration, known
 * check-in hour) across visit_requests + digital_passes + check_ins and
 * running the REAL processNightlyAggregation against it.
 *
 * BUG A (blocking — this is the one this file's `it.fails()` proves):
 * The `visitor.daily_metrics` INSERT is raw SQL that interpolates a JS
 * `Date` object directly:
 *   await tx.execute(sql`INSERT INTO visitor.daily_metrics (..., date, ...)
 *     VALUES (..., ${dayStart}, ...)`)
 * `dayStart` is a plain `new Date(Date.UTC(...))`, never converted to a
 * string. Every other raw `sql` fragment in this codebase that embeds a
 * timestamp does `.toISOString()` first (e.g. dpdp/purge-worker.ts's
 * retentionCutoff/erasureCutoff) — this one doesn't, and postgres-js's
 * parameter binding throws:
 *   TypeError: The "string" argument must be of type string or an
 *   instance of Buffer or ArrayBuffer. Received an instance of Date
 *     at Function.byteLength (node:buffer:781:11)
 * The per-location try/catch in processNightlyAggregation (worker.ts
 * ~223-228) swallows this as a `nightly_aggregation_location_failed`
 * warning and moves on — so the cycle "completes" and logs
 * `rowsInserted: 0`, but NO daily_metrics row is EVER written, for ANY
 * tenant, on ANY run, until dayStart is serialized as a string. Analytics
 * for this entire service has been silently producing zero data.
 *
 * BUG B (masked by Bug A, confirmed by static read, not independently
 * re-provable at the DB-row level while Bug A blocks every insert):
 * nightly-aggregation-worker.ts:161-177 — the check-in map is built keyed
 * by `checkIns.passId` (a digital_passes.id — see check-in/schema.ts and
 * migration 0003's `pass_id uuid NOT NULL REFERENCES
 * visitor.digital_passes(id)`):
 *   checkInMap.set(ci.passId, existing)                    // insert key
 * ...but read back with the VISIT REQUEST's id:
 *   const checkInData = checkInMap.get(vr.id)               // lookup key
 * `vr.id` (visitRequests.id) and `ci.passId` (digitalPasses.id) are
 * independently-random UUIDs that are never equal for real data, so
 * `checkInData` is always `undefined` and every visit's
 * `checkedInAt`/`checkedOutAt` are always null — meaning
 * `avg_visit_duration_ms` and `peak_hour` would ALSO always be null/wrong
 * even once Bug A is fixed, regardless of real check-in activity.
 * `total_visits`/`unique_visitors`/`no_show_count`/`rejected_count` don't
 * depend on the check-in map and are unaffected by either bug.
 *
 * The existing tests/analytics-domain.test.ts hand-verifies the pure
 * `computeDailyMetrics()` extensively and would not catch either bug —
 * both live entirely in how the DB-integration layer calls it / persists
 * its result.
 *
 * The tenant-isolation describe block below is independent of both bugs
 * above: it inserts daily_metrics rows directly (bypassing the broken
 * worker) to confirm the TABLE's own RLS isolates tenants correctly,
 * extending tests/tenant-isolation.integration.test.ts's coverage (which
 * covers visit_requests/digital_passes/check_ins but not daily_metrics).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { scannerDb } from "../src/shared/scanner-db.js";
import { processNightlyAggregation } from "../src/modules/analytics/nightly-aggregation-worker.js";
import { dailyMetrics } from "../src/modules/analytics/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { checkIns } from "../src/modules/check-in/schema.js";
import { locations, gates } from "../src/modules/location/schema.js";

const HOURS = 60 * 60_000;
const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

// "Yesterday" UTC bounds — must match processNightlyAggregation's own
// dayStart/dayEnd computation exactly so our fixture rows fall inside it.
const now = new Date();
const DAY_START = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
const CHECK_IN_AT = new Date(DAY_START.getTime() + 9 * HOURS); // yesterday 09:00 UTC
const CHECK_OUT_AT = new Date(DAY_START.getTime() + 11 * HOURS); // yesterday 11:00 UTC — exactly 2h visit

const ACTOR = randomUUID();

describe("nightly aggregation — hand-verified correctness for one known visit", () => {
  const TENANT = randomUUID();
  const LOCATION = randomUUID();
  const GATE = randomUUID();
  const VISIT_REQUEST_ID = randomUUID();
  const DIGITAL_PASS_ID = randomUUID();
  const CHECK_IN_ID = randomUUID();
  const CHECK_OUT_ID = randomUUID();

  beforeAll(async () => {
    await runWithTenant(TENANT, () =>
      db.transaction(async (tx) => {
        await tx.insert(locations).values({
          id: LOCATION, tenantId: TENANT, name: "AUDIT Analytics Loc",
          businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(gates).values({
          id: GATE, tenantId: TENANT, locationId: LOCATION, name: "AUDIT Gate",
          createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(visitRequests).values({
          id: VISIT_REQUEST_ID, tenantId: TENANT, locationId: LOCATION,
          hostEmployeeId: ACTOR, status: "checked_out",
          visitorName: "AUDIT Analytics Visitor", visitorPhone: "+919900088001",
          createdAt: CHECK_IN_AT, updatedAt: CHECK_IN_AT,
          createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(digitalPasses).values({
          id: DIGITAL_PASS_ID, tenantId: TENANT, visitRequestId: VISIT_REQUEST_ID,
          locationId: LOCATION, passNumber: "AUDANLY1", passType: "single",
          qrJwt: "audit.fixture.jwt", validFrom: CHECK_IN_AT, validUntil: CHECK_OUT_AT,
          createdBy: ACTOR, updatedBy: ACTOR,
        });
        // Real digital_passes.id as passId — deliberately NOT equal to
        // VISIT_REQUEST_ID, exactly as it is in production.
        await tx.insert(checkIns).values([
          {
            id: CHECK_IN_ID, tenantId: TENANT, passId: DIGITAL_PASS_ID,
            locationId: LOCATION, gateId: GATE, direction: "in",
            timestamp: CHECK_IN_AT, createdBy: ACTOR,
          },
          {
            id: CHECK_OUT_ID, tenantId: TENANT, passId: DIGITAL_PASS_ID,
            locationId: LOCATION, gateId: GATE, direction: "out",
            timestamp: CHECK_OUT_AT, createdBy: ACTOR,
          },
        ]);
      }),
    );
  });

  afterAll(async () => {
    await runWithTenant(TENANT, () =>
      db.transaction(async (tx) => {
        await tx.delete(dailyMetrics).where(eq(dailyMetrics.locationId, LOCATION));
        await tx.delete(checkIns).where(eq(checkIns.id, CHECK_IN_ID));
        await tx.delete(checkIns).where(eq(checkIns.id, CHECK_OUT_ID));
        await tx.delete(digitalPasses).where(eq(digitalPasses.id, DIGITAL_PASS_ID));
        await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID));
        await tx.delete(gates).where(eq(gates.id, GATE));
        await tx.delete(locations).where(eq(locations.id, LOCATION));
      }),
    );
  });

  it.fails(
    "[BUG A] a daily_metrics row should exist for tenant after a nightly run over one known visit",
    async () => {
      const result = await processNightlyAggregation(db, undefined, scannerDb);

      // Correct behavior: rowsInserted reflects the one active location.
      // Today this is always 0 — the raw-Date SQL parameter throws inside
      // the per-location try/catch before any INSERT can succeed (see file
      // header for the exact TypeError and root cause).
      expect(result.rowsInserted).toBe(1);

      const [row] = await runWithTenant(TENANT, () =>
        scopedRead((tx) => tx.select().from(dailyMetrics).where(eq(dailyMetrics.locationId, LOCATION))),
      );
      expect(row).toBeDefined();
      expect(row?.totalVisits).toBe(1);
      // Bug B (see file header): even once Bug A is fixed, these two would
      // still be wrong today because of the passId/visitRequestId key
      // mismatch in the check-in map.
      expect(row?.avgVisitDurationMs).toBe(CHECK_OUT_AT.getTime() - CHECK_IN_AT.getTime());
      expect(row?.peakHour).toBe(9);
    },
  );
});

describe("daily_metrics — tenant isolation (RLS)", () => {
  // Independent of the nightly-worker bugs above: rows inserted directly
  // via Drizzle (which serializes `date` correctly, unlike the worker's
  // raw sql`` fragment) to confirm the TABLE's own RLS isolates tenants.
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const LOCATION_A = randomUUID();
  const LOCATION_B = randomUUID();
  const METRIC_A = randomUUID();
  const METRIC_B = randomUUID();

  beforeAll(async () => {
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        await tx.insert(locations).values({
          id: LOCATION_A, tenantId: TENANT_A, name: "AUDIT Isolation Loc A",
          businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(dailyMetrics).values({
          id: METRIC_A, tenantId: TENANT_A, locationId: LOCATION_A, date: DAY_START,
          totalVisits: 5, uniqueVisitors: 4, noShowCount: 1, rejectedCount: 0,
        });
      }),
    );
    await runWithTenant(TENANT_B, () =>
      db.transaction(async (tx) => {
        await tx.insert(locations).values({
          id: LOCATION_B, tenantId: TENANT_B, name: "AUDIT Isolation Loc B",
          businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(dailyMetrics).values({
          id: METRIC_B, tenantId: TENANT_B, locationId: LOCATION_B, date: DAY_START,
          totalVisits: 9, uniqueVisitors: 8, noShowCount: 2, rejectedCount: 1,
        });
      }),
    );
  });

  afterAll(async () => {
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        await tx.delete(dailyMetrics).where(eq(dailyMetrics.id, METRIC_A));
        await tx.delete(locations).where(eq(locations.id, LOCATION_A));
      }),
    );
    await runWithTenant(TENANT_B, () =>
      db.transaction(async (tx) => {
        await tx.delete(dailyMetrics).where(eq(dailyMetrics.id, METRIC_B));
        await tx.delete(locations).where(eq(locations.id, LOCATION_B));
      }),
    );
  });

  it("tenant A cannot read tenant B's daily_metrics row by id", async () => {
    const rows = await runWithTenant(TENANT_A, () =>
      scopedRead((tx) => tx.select().from(dailyMetrics).where(eq(dailyMetrics.id, METRIC_B))),
    );
    expect(rows).toHaveLength(0);
  });

  it("tenant B cannot read tenant A's daily_metrics row by id", async () => {
    const rows = await runWithTenant(TENANT_B, () =>
      scopedRead((tx) => tx.select().from(dailyMetrics).where(eq(dailyMetrics.id, METRIC_A))),
    );
    expect(rows).toHaveLength(0);
  });

  it("each tenant sees only its own row in an unfiltered-by-id scan", async () => {
    const rowsA = await runWithTenant(TENANT_A, () =>
      scopedRead((tx) => tx.select().from(dailyMetrics).where(eq(dailyMetrics.locationId, LOCATION_A))),
    );
    const rowsB = await runWithTenant(TENANT_A, () =>
      scopedRead((tx) => tx.select().from(dailyMetrics).where(eq(dailyMetrics.locationId, LOCATION_B))),
    );
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]?.totalVisits).toBe(5);
    expect(rowsB).toHaveLength(0); // tenant A's session can't see location B's (tenant B) row
  });
});
