/**
 * COMP-007 -- ml-service `training` module (weekly cron-driven model
 * training orchestration: tenant/domain enumeration, data-threshold gating,
 * run bookkeeping, timeout handling, completion events) smoke test.
 *
 * Registered as a consumer per the scanner's classification, but this is a
 * scanner labeling nuance worth recording precisely: worker.ts calls
 * `startTrainingCron()` directly (a plain function call setting up a
 * setInterval-based cron, matching the scanner's "worker.ts binding is
 * called" signal) -- there is no `queue.subscribe()` anywhere in this
 * module. Tested accordingly below via direct function calls (orchestrator.ts's
 * real exports), not a MemoryQueue.
 *
 * REAL BUG, SEVERE (found while writing this test, not fixed here -- see PR
 * description), CONFIRMED VIA LIVE POSTGRES BEHAVIOR AND TRACED TO ITS SQL
 * ROOT CAUSE: the training cron's entire tenant/domain DISCOVERY layer is
 * silently, permanently non-functional -- `getActiveTenants()` returns an
 * empty array and `checkDataThreshold()` returns 0, ALWAYS, for every tenant
 * and domain, regardless of how much real feature-vector data exists. Root
 * cause: both call `db.execute(sql\`...\`)` directly, never wrapped in
 * `db.transaction()` -- and `wrapWithTenantGuc` (packages/db/src/
 * wrap-tenant-db.ts) ONLY injects the `app.tenant_id` GUC around
 * `db.transaction()` calls, never around a bare `.execute()`. `ml_feature_
 * vectors` has FORCE ROW LEVEL SECURITY with policy
 * `tenant_id = ml.current_tenant_id()`, and `ml.current_tenant_id()`
 * (migrations/0001_ml_schema.sql) is
 * `NULLIF(current_setting('app.tenant_id', true), '')::uuid` -- NULL when
 * unset, and `tenant_id = NULL` is never true in SQL, so RLS silently
 * filters out every row. Confirmed live below (and independently, against a
 * fresh disposable Postgres with 10 real rows freshly inserted via a
 * correctly-scoped transaction for a specific tenant): `getActiveTenants()`
 * still returns zero tenants, `checkDataThreshold()` still returns 0 for
 * that exact tenant+domain. `ml_svc` (the connecting role) has no BYPASSRLS
 * attribute (`\du ml_svc` confirmed), so there is no other mechanism by
 * which these bare queries could see cross-tenant data either --
 * getActiveTenants()'s own doc comment says it "intentionally scans across
 * ALL tenants... this is the documented cross-tenant sweeper exception", but
 * the implementation does not actually achieve that: it sees NO tenants at
 * all, not all of them. Net effect in production: `runTrainingLoop()` (the
 * cron's entire body) enumerates zero tenants every single time it fires,
 * logs "enumerated 0 active tenants", and returns having done nothing --
 * forever, silently, with no error anywhere. This is NOT the same issue as
 * the placeholder executeTraining() below; it is upstream of it and more
 * severe, since it means the pipeline never even reaches the point of
 * calling executeTraining() for real tenant data.
 *
 * What IS real and correctly tenant-scoped, and unaffected by the bug above:
 * `trainTenantDomain()` itself (run-record bookkeeping: queued -> running ->
 * completed/failed, in-flight dedup, the training.completed event) --
 * because unlike the two functions above, every one of ITS db calls is
 * wrapped in `runWithTenant(tenantId, () => db.transaction(...))`, the
 * correct pattern. Given a real tenantId from anywhere else, this half of
 * the pipeline works. Confirmed below.
 *
 * DEAD CODE, disclosed but not addressed here (out of scope for a
 * test-adding tranche -- and already self-disclosed by the code's own
 * comments, not a hidden defect this tranche is the first to find): this
 * directory's other three files -- data-extractor.ts (567 LOC),
 * drift-detection.ts (602 LOC), evaluation.ts (519 LOC), ~1700 of this
 * module's 2188 total LOC -- export many well-formed pure functions
 * (computeWindowStart, meetsMinimumVolume, computeKLDivergence,
 * meetsDomainThreshold, etc.) but grepping this ENTIRE service finds no
 * import of any of them from anywhere, including orchestrator.ts itself.
 * orchestrator.ts's own `executeTraining()` is an explicit placeholder
 * ("Placeholder: In tasks 8.2 and 8.3 this will be wired to: 1. Extract
 * training data... For now return placeholder metrics so the orchestration
 * loop works end-to-end") that always returns `{ metrics: {}, modelId: null
 * }` regardless of tenant, domain, or real data.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "@civitasone/outbox";
import { mlFeatureVectors } from "../src/modules/feature-store/schema.js";
import { mlTrainingRuns } from "../src/modules/training/schema.js";
import {
  parseCronSchedule,
  shouldTrigger,
  checkDataThreshold,
  getActiveTenants,
  trainTenantDomain,
  DEFAULT_TRAINING_CONFIG,
} from "../src/modules/training/orchestrator.js";

afterAll(async () => {
  await sqlClient.end();
});

async function seedFeatureVectors(tenantId: string, domain: string, count: number) {
  return runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      for (let i = 0; i < count; i++) {
        await tx.insert(mlFeatureVectors).values({
          tenantId, domain, entityId: randomUUID(), features: { i },
        });
      }
    }),
  );
}

describe("COMP-007: training -- parseCronSchedule / shouldTrigger (pure logic)", () => {
  it("defaults to Sunday 02:00 UTC for empty/missing/malformed input", () => {
    expect(parseCronSchedule()).toEqual({ dayOfWeek: 0, hour: 2, minute: 0 });
    expect(parseCronSchedule("")).toEqual({ dayOfWeek: 0, hour: 2, minute: 0 });
    expect(parseCronSchedule("garbage")).toEqual({ dayOfWeek: 0, hour: 2, minute: 0 });
    expect(parseCronSchedule("9 25:99")).toEqual({ dayOfWeek: 0, hour: 2, minute: 0 }); // out of range
  });

  it("parses a valid custom schedule", () => {
    expect(parseCronSchedule("3 14:30")).toEqual({ dayOfWeek: 3, hour: 14, minute: 30 });
  });

  it("shouldTrigger matches only the exact configured day/hour/minute", () => {
    const schedule = { dayOfWeek: 0, hour: 2, minute: 0 };
    expect(shouldTrigger(new Date("2026-09-20T02:00:00.000Z"), schedule)).toBe(true); // a Sunday
    expect(shouldTrigger(new Date("2026-09-20T02:01:00.000Z"), schedule)).toBe(false);
    expect(shouldTrigger(new Date("2026-09-21T02:00:00.000Z"), schedule)).toBe(false); // a Monday
  });
});

describe("COMP-007: training -- KNOWN ISSUE (see file header): checkDataThreshold and getActiveTenants always see zero rows, real Postgres RLS confirmed", () => {
  it("checkDataThreshold returns 0 even when real data exists comfortably ABOVE the domain's configured minimum -- documents the bug, not the intended gate behavior", async () => {
    const tid = randomUUID();
    await seedFeatureVectors(tid, "tasks", DEFAULT_TRAINING_CONFIG.minRecords.tasks * 10);
    const count = await checkDataThreshold(tid, "tasks");
    // NOT proof the gate works -- this IS the bug: a real, correctly-scoped
    // insert (seedFeatureVectors uses runWithTenant + db.transaction, the
    // correct pattern) is invisible to checkDataThreshold's bare db.execute(),
    // which never has the RLS GUC set. Confirmed independently against a
    // fresh disposable Postgres with 10 fresh rows for a specific tenant.
    expect(count).toBe(0);
  });

  it("checkDataThreshold returns 0 below the minimum too -- for the WRONG reason (RLS hides everything, not real gating)", async () => {
    const tid = randomUUID();
    await seedFeatureVectors(tid, "tasks", 2);
    const count = await checkDataThreshold(tid, "tasks");
    expect(count).toBe(0); // looks correct, isn't -- see the test above for proof this isn't real gating
  });

  it("getActiveTenants returns an empty array even when real feature-vector data exists for a real tenant", async () => {
    const tid = randomUUID();
    await seedFeatureVectors(tid, "leads", 50);
    const tenants = await getActiveTenants();
    // NOT the "no tenants have ML data yet" case -- we just seeded one. This
    // is the same bug: getActiveTenants()'s bare db.execute() never has the
    // RLS GUC set, so it sees nothing, for anyone, ever -- despite its own
    // doc comment's intent to deliberately bypass tenant scoping for this
    // exact enumeration purpose.
    expect(tenants).toEqual([]);
  });
});

describe("COMP-007: training -- trainTenantDomain (real DB, the module's actual working core)", () => {
  it("a genuine run: queued->running->completed, real DB verified, and emits one training.completed event", async () => {
    const tid = randomUUID();
    const result = await trainTenantDomain(tid, "tasks", 42);

    expect(result.status).toBe("completed");
    expect(result.metrics).toEqual({}); // the documented placeholder -- see file header
    expect(typeof result.durationMs).toBe("number");

    const runs = await runWithTenant(tid, () =>
      db.transaction((tx) => tx.select().from(mlTrainingRuns).where(eq(mlTrainingRuns.tenantId, tid))),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].recordCount).toBe(42);
    expect(runs[0].startedAt).toBeTruthy();
    expect(runs[0].completedAt).toBeTruthy();
    expect(runs[0].modelId).toBeNull(); // placeholder executeTraining never registers a model

    // training.completed is enqueued with a fresh correlationId internal to
    // trainTenantDomain (not caller-supplied) -- find it via the run's own id.
    const allOutbox = await db.select().from(outboxMessages).where(eq(outboxMessages.topic, "ml.training.completed"));
    const mine = allOutbox.find((r: any) => (r.payload as any)?.trainingRunId === runs[0].id);
    expect(mine).toBeTruthy();
    expect((mine!.payload as any).status).toBe("completed");
    expect((mine!.payload as any).tenantId).toBe(tid);
  });

  it("is tenant-scoped: a run recorded for tenant A is not visible reading back under tenant B", async () => {
    const tidA = randomUUID();
    const tidB = randomUUID();
    await trainTenantDomain(tidA, "leads", 200);

    const asB = await runWithTenant(tidB, () =>
      db.transaction((tx) => tx.select().from(mlTrainingRuns).where(eq(mlTrainingRuns.tenantId, tidA))),
    );
    expect(asB).toEqual([]);
  });

  it("in-flight dedup: calling it twice concurrently for the SAME tenant+domain skips the second, real DB confirms only one run row exists", async () => {
    const tid = randomUUID();
    const [first, second] = await Promise.all([
      trainTenantDomain(tid, "inventory", 30),
      trainTenantDomain(tid, "inventory", 30),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["completed", "skipped"]);

    const runs = await runWithTenant(tid, () =>
      db.transaction((tx) => tx.select().from(mlTrainingRuns).where(eq(mlTrainingRuns.tenantId, tid))),
    );
    expect(runs).toHaveLength(1); // the skipped call never inserted a row
  });

  it("after completion, the SAME tenant+domain can run again (dedup is in-flight only, not a permanent lock)", async () => {
    const tid = randomUUID();
    const first = await trainTenantDomain(tid, "subscriptions", 50);
    expect(first.status).toBe("completed");

    const second = await trainTenantDomain(tid, "subscriptions", 50);
    expect(second.status).toBe("completed");

    const runs = await runWithTenant(tid, () =>
      db.transaction((tx) => tx.select().from(mlTrainingRuns).where(eq(mlTrainingRuns.tenantId, tid))),
    );
    expect(runs).toHaveLength(2);
  });
});
