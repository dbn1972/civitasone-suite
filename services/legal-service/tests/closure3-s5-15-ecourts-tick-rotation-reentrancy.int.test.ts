/**
 * CLOS3-S5-15 -- (1) tick() used an unordered LIMIT 500 so with >500 tracked
 * matters the same arbitrary subset was synced every hour and the rest
 * starved; (2) the hearing check-then-insert had no unique constraint so
 * overlapping syncs inserted the same hearing twice.
 *
 * Real Postgres (non-superuser legal_svc, FORCE RLS) + legal_scanner role.
 * Fails loudly (never skips) when LEGAL_SCANNER_DATABASE_URL is absent; the always-on re-entrancy
 * unit test (closure3-s5-15-ecourts-tick-busy.test.ts) covers CI.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { acquireEcourtsDbLock } from "./helpers/ecourts-db-lock.js";

// Barrier: when armed, lookupCnr holds every caller until N have arrived, so the
// follow-up SELECT-then-INSERT transactions start at the same instant.
const gate = vi.hoisted(() => ({ want: 0, seen: 0, open: undefined as undefined | (() => void), p: undefined as undefined | Promise<void> }));
vi.mock("../src/modules/ecourts/adapter.js", () => ({
  isEnabled: () => true,
  lookupCnr: async (cnr: string) => {
    if (gate.want > 0) {
      gate.p ??= new Promise<void>((r) => { gate.open = r; });
      if (++gate.seen >= gate.want) gate.open!();
      await gate.p;
    }
    return mk(cnr);
  },
}));
const mk = (cnr: string) => ({
    cnrNumber: cnr, caseStatus: "pending", courtName: "High Court", lastUpdated: "2026-10-01",
    hearingDates: [{ date: "2099-01-01", purpose: "Arguments" }], orders: [],
  });

const HAVE_SCANNER = Boolean(process.env["LEGAL_SCANNER_DATABASE_URL"]);
if (!HAVE_SCANNER) throw new Error("closure3-s5-15: LEGAL_SCANNER_DATABASE_URL is not set (CI sets it via vitest.config.ts; locally export the legal_scanner DSN of your disposable Postgres)");
const TENANT = "c3a51500-dead-4000-8000-00000000000a";
const ACTOR = "c3a51500-dead-4000-8000-0000000000ac";
const CAP = 500; // tick()'s per-run cap

describe("CLOS3-S5-15 e-Courts tick rotation and hearing idempotency", () => {
  let db: typeof import("../src/shared/db.js").db;
  let sqlClient: typeof import("../src/shared/db.js").sqlClient;
  let scannerSqlClient: typeof import("../src/shared/scanner-db.js").scannerSqlClient | undefined;
  let causeListSyncs: typeof import("../src/modules/ecourts/sync-schema.js").causeListSyncs;
  let legalHearings: typeof import("../src/modules/hearings/schema.js").legalHearings;
  let tick: typeof import("../src/modules/ecourts/sync-consumer.js").tick;
  let syncMatter: typeof import("../src/modules/ecourts/sync-consumer.js").syncMatter;

  const clean = () =>
    runWithTenant(TENANT, () =>
      db.transaction(async (tx) => {
        await tx.delete(legalHearings).where(eq(legalHearings.tenantId, TENANT));
        await tx.delete(causeListSyncs).where(eq(causeListSyncs.tenantId, TENANT));
      }),
    );

  let unlock: () => Promise<void> = async () => {};

  beforeAll(async () => {
    unlock = await acquireEcourtsDbLock();
    ({ db, sqlClient } = await import("../src/shared/db.js"));
    ({ causeListSyncs } = await import("../src/modules/ecourts/sync-schema.js"));
    ({ legalHearings } = await import("../src/modules/hearings/schema.js"));
    try { ({ scannerSqlClient } = await import("../src/shared/scanner-db.js")); } catch { /* absent pre-S5-07 */ }
    ({ tick, syncMatter } = await import("../src/modules/ecourts/sync-consumer.js"));
    await clean();
  });
  afterAll(async () => {
    await clean();
    await scannerSqlClient?.end();
    await sqlClient.end();
    await unlock();
  });

  it("a tick picks never-synced matters ahead of recently-synced ones (no starvation past the cap)", async () => {
    const recent = Array.from({ length: 2 }, (_, i) => ({
      tenantId: TENANT, caseId: randomUUID(), cnrNumber: `RECENT${i}`, createdBy: ACTOR, updatedBy: ACTOR,
      lastSyncAt: new Date(), lastSyncStatus: "success",
    }));
    const never = Array.from({ length: CAP }, (_, i) => ({
      tenantId: TENANT, caseId: randomUUID(), cnrNumber: `NEVER${i}`, createdBy: ACTOR, updatedBy: ACTOR,
    }));
    // Recent rows are inserted FIRST so an unordered LIMIT (physical order) takes them and starves 2 never-synced rows.
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(causeListSyncs).values(recent)));
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(causeListSyncs).values(never)));

    const res = await tick();
    expect(res).toEqual({ synced: CAP, failed: 0 });

    const pending = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select({ cnr: causeListSyncs.cnrNumber }).from(causeListSyncs).where(eq(causeListSyncs.lastSyncStatus, "pending"))),
    );
    expect(pending, "never-synced matters must not be starved by an unordered LIMIT").toHaveLength(0);
  }, 120_000);

  it("concurrent syncMatter calls for one case+date insert exactly one hearing", async () => {
    const caseId = randomUUID();
    // Warm the whole pool first: with cold connections the 8 transactions start staggered and
    // the first one commits before the others SELECT, hiding the race.
    await runWithTenant(TENANT, () =>
      Promise.all(Array.from({ length: 10 }, () => db.transaction((tx) => tx.execute(sql`select pg_sleep(0.2)`)))),
    );
    gate.want = 8; gate.seen = 0; gate.p = undefined;
    await runWithTenant(TENANT, () =>
      Promise.all(Array.from({ length: 8 }, () => syncMatter(caseId, "CNRDUP", TENANT))),
    );
    gate.want = 0;
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(legalHearings).where(eq(legalHearings.caseId, caseId))),
    );
    expect(rows).toHaveLength(1);
    // keep sql import used for a direct constraint probe
    const idx = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.execute(sql`select 1 from pg_indexes where indexname = 'uq_legal_hearings_ecourts_sync'`)),
    );
    expect(idx.length).toBe(1);
  }, 60_000);
});
