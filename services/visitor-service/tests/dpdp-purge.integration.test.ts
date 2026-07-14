/**
 * Fix 1 (cross-tenant workers no-op under RLS) + Fix 2 (DPDP right-to-erasure
 * is a no-op).
 *
 * Drives the real `processPurgeCycle` against the live DB using the BYPASSRLS
 * scanner pool for the cross-tenant scan and the primary (visitor_svc) pool for
 * the tenant-scoped writes. Proves:
 *   - Fix 1: rows in TWO different tenants are both purged in one run.
 *   - Fix 2: a row whose erasure_requested_at is older than the 72h SLA is purged
 *     even though it is NOT past the 365-day retention cutoff — and a fresh row
 *     with no erasure request is left untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { scannerDb } from "../src/shared/scanner-db.js";
import { processPurgeCycle, PURGED_SENTINEL } from "../src/modules/dpdp/purge-worker.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations } from "../src/modules/location/schema.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const LOCATION_A = randomUUID();
const LOCATION_B = randomUUID();
const ACTOR = randomUUID();

const ERASURE_ID = randomUUID(); // tenant A: erasure-requested, NOT retention-expired
const CONTROL_ID = randomUUID(); // tenant A: fresh, no erasure -> must survive
const RETENTION_ID = randomUUID(); // tenant B: retention-expired

const HOURS = 60 * 60_000;
const DAYS = 24 * HOURS;
const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
};

async function insertLocation(tenant: string, locId: string) {
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(locations).values({
        id: locId,
        tenantId: tenant,
        name: "Loc",
        businessHours: BUSINESS_HOURS,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
}

async function insert(tenant: string, locId: string, id: string, patch: Record<string, unknown>) {
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(visitRequests).values({
        id,
        tenantId: tenant,
        locationId: locId,
        hostEmployeeId: randomUUID(),
        visitorName: `name-${id}`,
        visitorPhone: "+911234567890",
        createdBy: ACTOR,
        updatedBy: ACTOR,
        ...patch,
      }),
    ),
  );
}

async function readName(tenant: string, id: string): Promise<string | null> {
  const rows = await runWithTenant(tenant, () =>
    scopedRead((tx) =>
      tx
        .select({ visitorName: visitRequests.visitorName })
        .from(visitRequests)
        .where(eq(visitRequests.id, id)),
    ),
  );
  return rows[0]?.visitorName ?? null;
}

beforeAll(async () => {
  await insertLocation(TENANT_A, LOCATION_A);
  await insertLocation(TENANT_B, LOCATION_B);
  const now = Date.now();
  await insert(TENANT_A, LOCATION_A, ERASURE_ID, {
    createdAt: new Date(now),
    erasureRequestedAt: new Date(now - 80 * HOURS),
  });
  await insert(TENANT_A, LOCATION_A, CONTROL_ID, { createdAt: new Date(now) });
  await insert(TENANT_B, LOCATION_B, RETENTION_ID, { createdAt: new Date(now - 400 * DAYS) });
});

afterAll(async () => {
  for (const [tenant, id] of [
    [TENANT_A, ERASURE_ID],
    [TENANT_A, CONTROL_ID],
    [TENANT_B, RETENTION_ID],
  ] as const) {
    await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.delete(visitRequests).where(eq(visitRequests.id, id))),
    );
  }
  await runWithTenant(TENANT_A, () =>
    db.transaction((tx) => tx.delete(locations).where(eq(locations.id, LOCATION_A))),
  );
  await runWithTenant(TENANT_B, () =>
    db.transaction((tx) => tx.delete(locations).where(eq(locations.id, LOCATION_B))),
  );
});

describe("DPDP purge — cross-tenant scan + erasure SLA", () => {
  it("purges erasure-requested and retention-expired rows across tenants, keeps fresh rows", async () => {
    const result = await processPurgeCycle(db, scannerDb, {
      retentionPeriodMs: 365 * DAYS,
      erasureSlaMs: 72 * HOURS,
      batchSize: 500,
    });

    // Cross-tenant: both tenants had rows purged in a single run (Fix 1).
    expect(result.purgedByTenant[TENANT_A] ?? 0).toBeGreaterThanOrEqual(1);
    expect(result.purgedByTenant[TENANT_B] ?? 0).toBeGreaterThanOrEqual(1);

    // Fix 2: erasure-requested row purged despite not being retention-expired.
    expect(await readName(TENANT_A, ERASURE_ID)).toBe(PURGED_SENTINEL);
    // Retention-expired row in the OTHER tenant purged too.
    expect(await readName(TENANT_B, RETENTION_ID)).toBe(PURGED_SENTINEL);
    // Fresh, non-erasure row survives.
    expect(await readName(TENANT_A, CONTROL_ID)).toBe(`name-${CONTROL_ID}`);
  });
});
