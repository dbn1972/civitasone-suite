/**
 * CLOS3-S5-07 -- the e-Courts cause-list sync tick read ecourts.cause_list_syncs
 * through the plain tenant pool with no tenant context. The table is FORCE RLS
 * (USING tenant_id = current_setting('app.tenant_id')::uuid, no missing_ok), so
 * under the NOBYPASSRLS service role the cross-tenant read errored/returned
 * nothing and sync never ran. Discovery now uses the SELECT-only scanner pool
 * and every per-matter read/write runs inside runWithTenant(matter.tenantId).
 *
 * Real Postgres. DATABASE_URL = non-superuser legal_svc (NOBYPASSRLS);
 * LEGAL_SCANNER_DATABASE_URL = the legal_scanner role from migration 0028.
 * Fails loudly (never skips) when LEGAL_SCANNER_DATABASE_URL is not provided; the
 * always-on unit/static tests (closure3-s5-07-*.test.ts) cover CI.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { acquireEcourtsDbLock } from "./helpers/ecourts-db-lock.js";

const H = vi.hoisted(() => ({ failCnr: new Set<string>() }));
vi.mock("../src/modules/ecourts/adapter.js", () => ({
  isEnabled: () => true,
  lookupCnr: async (cnr: string) => {
    if (H.failCnr.has(cnr)) throw new Error("e-Courts upstream 500");
    return {
      cnrNumber: cnr, caseStatus: "pending", courtName: "High Court", lastUpdated: "2026-10-01",
      hearingDates: [{ date: "2099-01-01", purpose: "Arguments" }], orders: [],
    };
  },
}));

const HAVE_SCANNER = Boolean(process.env["LEGAL_SCANNER_DATABASE_URL"]);
if (!HAVE_SCANNER) throw new Error("closure3-s5-07: LEGAL_SCANNER_DATABASE_URL is not set (CI sets it via vitest.config.ts; locally export the legal_scanner DSN of your disposable Postgres)");

const TENANT_A = "c3a50700-dead-4000-8000-00000000000a";
const TENANT_B = "c3a50700-dead-4000-8000-00000000000b";
const ACTOR = "c3a50700-dead-4000-8000-0000000000ac";

describe("CLOS3-S5-07 e-Courts sync runs per tenant under FORCE RLS", () => {
  let db: typeof import("../src/shared/db.js").db;
  let sqlClient: typeof import("../src/shared/db.js").sqlClient;
  let scannerSqlClient: typeof import("../src/shared/scanner-db.js").scannerSqlClient | undefined;
  let causeListSyncs: typeof import("../src/modules/ecourts/sync-schema.js").causeListSyncs;
  let legalHearings: typeof import("../src/modules/hearings/schema.js").legalHearings;
  let tick: typeof import("../src/modules/ecourts/sync-consumer.js").tick;

  const caseA = randomUUID();
  const caseB = randomUUID();
  const cnrA = "DLHC010000012026";
  const cnrB = "DLHC010000022026";

  const clean = async (tenant: string) =>
    runWithTenant(tenant, () =>
      db.transaction(async (tx) => {
        await tx.delete(legalHearings).where(eq(legalHearings.tenantId, tenant));
        await tx.delete(causeListSyncs).where(eq(causeListSyncs.tenantId, tenant));
      }),
    );

  let unlock: () => Promise<void> = async () => {};

  beforeAll(async () => {
    unlock = await acquireEcourtsDbLock();
    ({ db, sqlClient } = await import("../src/shared/db.js"));
    ({ causeListSyncs } = await import("../src/modules/ecourts/sync-schema.js"));
    ({ legalHearings } = await import("../src/modules/hearings/schema.js"));
    try { ({ scannerSqlClient } = await import("../src/shared/scanner-db.js")); } catch { /* pre-fix: module absent */ }
    ({ tick } = await import("../src/modules/ecourts/sync-consumer.js"));
    for (const t of [TENANT_A, TENANT_B]) await clean(t);
    for (const [t, caseId, cnr] of [[TENANT_A, caseA, cnrA], [TENANT_B, caseB, cnrB]] as const) {
      await runWithTenant(t, () =>
        db.transaction((tx) =>
          tx.insert(causeListSyncs).values({ tenantId: t, caseId, cnrNumber: cnr, createdBy: ACTOR, updatedBy: ACTOR }),
        ),
      );
    }
  });

  afterAll(async () => {
    for (const t of [TENANT_A, TENANT_B]) await clean(t);
    await scannerSqlClient?.end();
    await sqlClient.end();
    await unlock();
  });

  it("syncs matters of every tenant, recording success and failure under that tenant's context", async () => {
    H.failCnr.add(cnrB); // tenant B's upstream fails -> failure branch must also write under RLS
    const res = await tick();
    expect(res).toEqual({ synced: 1, failed: 1 });

    const rowA = (await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(causeListSyncs))))[0]!;
    const rowB = (await runWithTenant(TENANT_B, () => db.transaction((tx) => tx.select().from(causeListSyncs))))[0]!;
    expect(rowA.lastSyncStatus).toBe("success");
    expect(rowA.version).toBe(2);
    expect(rowB.lastSyncStatus).toBe("failed");
    expect(rowB.lastError).toContain("upstream 500");

    const hearingsA = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(legalHearings)));
    expect(hearingsA).toHaveLength(1);
    expect(hearingsA[0]!.tenantId).toBe(TENANT_A);
    // tenant B's context must not see tenant A's rows
    const hearingsB = await runWithTenant(TENANT_B, () => db.transaction((tx) => tx.select().from(legalHearings)));
    expect(hearingsB).toHaveLength(0);
  }, 30_000);
});
