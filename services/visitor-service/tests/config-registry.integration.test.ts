/**
 * Integration test: tenant-differentiated policy via the config engine.
 *
 * Drives the REAL config_entries table (RLS-scoped writes via the visitor_svc
 * pool) + the migrated read paths against the live DB, proving two government
 * offices run different policy from the SAME code:
 *
 *   1. DPDP retention (worker path): tenant A overrides retention to 1 day; a
 *      5-day-old visit record purges for A but NOT for B (B uses the 365-day
 *      default). Exercises loadNamespaceOverrides + processPurgeCycle end-to-end.
 *   2. Approval policy (consumer path): tenant A's auto-approve set is
 *      {contractor} (replacing the default {vip}); getAutoApproveCategories +
 *      resolveInitialStatus auto-approve a contractor for A but leave B pending.
 *   3. Config getters: getPolicyNumber returns A's override and B's default.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { scannerDb } from "../src/shared/scanner-db.js";
import { processPurgeCycle, PURGED_SENTINEL } from "../src/modules/dpdp/purge-worker.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations } from "../src/modules/location/schema.js";
import { configEntries } from "../src/modules/config-registry/schema.js";
import {
  getPolicyNumber,
  getAutoApproveCategories,
  POLICY_NS,
  APPROVAL_NS,
} from "../src/modules/config-registry/policy.js";
import { deriveConfigId } from "../src/modules/config-registry/domain.js";
import { resolveInitialStatus } from "../src/modules/visit-request/domain.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const LOCATION_A = randomUUID();
const LOCATION_B = randomUUID();
const ACTOR = randomUUID();
const VR_A = randomUUID();
const VR_B = randomUUID();

const DAYS = 24 * 60 * 60_000;
const BUSINESS_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

async function insertLocation(tenant: string, locId: string) {
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(locations).values({
        id: locId, tenantId: tenant, name: "Loc", businessHours: BUSINESS_HOURS,
        createdBy: ACTOR, updatedBy: ACTOR,
      }),
    ),
  );
}

async function insertVisit(tenant: string, locId: string, id: string, createdAt: Date) {
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(visitRequests).values({
        id, tenantId: tenant, locationId: locId, hostEmployeeId: randomUUID(),
        visitorName: `name-${id}`, visitorPhone: "+911234567890",
        createdAt, createdBy: ACTOR, updatedBy: ACTOR,
      }),
    ),
  );
}

async function setConfig(tenant: string, namespace: string, key: string, value: unknown) {
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(configEntries).values({
        id: deriveConfigId(tenant, namespace, key),
        tenantId: tenant, namespace, configKey: key, value,
        createdBy: ACTOR, updatedBy: ACTOR,
      }),
    ),
  );
}

async function readName(tenant: string, id: string): Promise<string | null> {
  const rows = await runWithTenant(tenant, () =>
    scopedRead((tx) =>
      tx.select({ visitorName: visitRequests.visitorName }).from(visitRequests).where(eq(visitRequests.id, id)),
    ),
  );
  return rows[0]?.visitorName ?? null;
}

beforeAll(async () => {
  await insertLocation(TENANT_A, LOCATION_A);
  await insertLocation(TENANT_B, LOCATION_B);
  const now = Date.now();
  // Both tenants: a 5-day-old visit record with un-purged PII.
  await insertVisit(TENANT_A, LOCATION_A, VR_A, new Date(now - 5 * DAYS));
  await insertVisit(TENANT_B, LOCATION_B, VR_B, new Date(now - 5 * DAYS));
  // Tenant A ONLY: retention = 1 day, and auto-approve = {contractor}.
  await setConfig(TENANT_A, POLICY_NS, "retention.pii_days", 1);
  await setConfig(TENANT_A, APPROVAL_NS, "contractor", { autoApprove: true });
});

afterAll(async () => {
  for (const [t, id] of [[TENANT_A, VR_A], [TENANT_B, VR_B]] as const) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(visitRequests).where(eq(visitRequests.id, id))));
  }
  await runWithTenant(TENANT_A, () =>
    db.transaction((tx) => tx.delete(configEntries).where(eq(configEntries.tenantId, TENANT_A))),
  );
  await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.delete(locations).where(eq(locations.id, LOCATION_A))));
  await runWithTenant(TENANT_B, () => db.transaction((tx) => tx.delete(locations).where(eq(locations.id, LOCATION_B))));
});

describe("config engine — tenant-differentiated policy", () => {
  it("getPolicyNumber returns tenant A's override and tenant B's default", async () => {
    const aDays = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => getPolicyNumber(tx, TENANT_A, "retention.pii_days")),
    );
    const bDays = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => getPolicyNumber(tx, TENANT_B, "retention.pii_days")),
    );
    expect(aDays).toBe(1);
    expect(bDays).toBe(365);
  });

  it("DPDP purge: tenant A (retention 1d) purges the 5-day-old row; tenant B (default 365d) does not", async () => {
    const result = await processPurgeCycle(db, scannerDb, {
      retentionPeriodMs: 365 * DAYS,
      erasureSlaMs: 72 * 60 * 60_000,
      batchSize: 500,
    });
    // A purged, B untouched.
    expect(result.purgedByTenant[TENANT_A] ?? 0).toBeGreaterThanOrEqual(1);
    expect(result.purgedByTenant[TENANT_B] ?? 0).toBe(0);
    expect(await readName(TENANT_A, VR_A)).toBe(PURGED_SENTINEL);
    expect(await readName(TENANT_B, VR_B)).toBe(`name-${VR_B}`);
  });

  it("approval policy: A auto-approves contractor (set replaces default), B leaves it pending", async () => {
    const setA = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => getAutoApproveCategories(tx, TENANT_A)),
    );
    const setB = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => getAutoApproveCategories(tx, TENANT_B)),
    );
    // A's configured set REPLACES the default {vip}.
    expect(setA.has("contractor")).toBe(true);
    expect(setA.has("vip")).toBe(false);
    // B unconfigured → default {vip}.
    expect(setB.has("vip")).toBe(true);
    expect(setB.has("contractor")).toBe(false);

    expect(resolveInitialStatus("portal", "contractor", setA)).toBe("approved");
    expect(resolveInitialStatus("portal", "contractor", setB)).toBe("pending_approval");
  });
});
