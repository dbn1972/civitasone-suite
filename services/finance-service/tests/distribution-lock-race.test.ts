/**
 * SVC-033 — allocation-distribution consumer's FOR UPDATE lock (TOCTOU
 * regression), tested directly and deterministically against the real dev DB.
 *
 * BACKGROUND: distribution-routes.test.ts's "concurrent distributions cannot
 * jointly overdraw the allocation (TOCTOU race)" test fires two real HTTP
 * requests through Promise.all and, after drain(), checks the persisted
 * invariant. That is a legitimate end-to-end smoke check, but it can only
 * catch a broken guard when the two consumer transactions HAPPEN to overlap
 * in real time — and they usually don't: the route's own synchronous
 * pre-check, the HTTP round trip, and MemoryQueue.publish's fire-and-forget
 * setTimeout(0) delivery (see @civitasone/queue-service's bus.ts) all sit
 * between "test fires both requests" and "the two consumer transactions
 * actually run", each adding independent scheduling/I-O jitter. Measured by
 * sabotaging the guard (swapping consumer.ts's lockAllocationByIdTx for the
 * unlocked findAllocationByIdTx) and rerunning that test 8 times, it caught
 * the break only 1/8 runs (12%) — a regression that removes the row lock
 * would very likely merge silently through CI.
 *
 * THIS FILE closes that gap by testing the consumer's actual guarded logic
 * (handleAllocationDistributionCreate, exported from consumer.ts for exactly
 * this purpose) directly, with a deterministic barrier that FORCES the two
 * transactions to overlap on every run instead of hoping real-world timing
 * cooperates:
 *
 *   1. Transaction A runs handleAllocationDistributionCreate() for real,
 *      through to the point where it has read the current distributed sum
 *      (repo.sumDistributedTx) and captured it locally — then pauses there
 *      (via the `afterSumRead` test hook) with its Postgres transaction
 *      still open and, if the lock is intact, its FOR UPDATE row lock still
 *      held.
 *   2. Only once A has signalled it is paused does the test start
 *      Transaction B — an ordinary, unmodified second call to the same
 *      handler, exactly like a second consumer delivery.
 *   3. The test then waits a generous, one-directional margin (300ms — see
 *      concurrent-writes.test.ts for the same order-of-magnitude precedent
 *      elsewhere in this service) before releasing A. This is not a race A
 *      might lose: it is an upper bound on how long a fast, unlocked local
 *      read+insert would ever take, so by the time A resumes, B has
 *      DEFINITELY either (a) completed its own read+insert (if the lock is
 *      broken — B was never blocked) or (b) is still parked inside Postgres
 *      waiting on A's row lock (if the lock is intact — B never got past its
 *      own lockAllocationByIdTx call). Either way, A's transaction has
 *      genuinely stayed open and overlapped with B's attempt for the entire
 *      window, by construction, not by chance.
 *
 * Pausing AFTER the sum read (not merely after lock acquisition) matters: if
 * A paused before reading the sum, resuming would just re-read the
 * now-current total and correctly self-reject even with a broken lock,
 * masking the very race we're trying to prove closed. Pausing with a stale
 * `distributed` already captured is what lets a concurrent unlocked insert
 * slip in invisibly — exactly the TOCTOU window lockAllocationByIdTx exists
 * to close.
 *
 * Verified against this file: reproducing the reviewer's exact sabotage
 * (lockAllocationByIdTx -> findAllocationByIdTx in consumer.ts) and rerunning
 * the test below 10 times caught the broken guard 10/10 (vs. 1/8 for the
 * end-to-end HTTP test) — see the PR commit message for the full readout.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import {
  handleAllocationDistributionCreate,
  type AllocationDistributionCreatePayload,
} from "../src/modules/budget/consumer.js";
import { financeAllocationDistributions } from "../src/modules/budget/distribution-schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { scoped } from "./_tenant.js";

const TENANT = "aaaaaaaa-3333-4000-8000-0000000fd900";
const ACTOR = "00000000-aaaa-4000-8000-00000000d900";
const HEAD = "00000000-bbbb-4000-8000-00000000d900";
const OFFICE_HQ = "00000000-cccc-4000-8000-000000000d01";
const OFFICE_A = "00000000-cccc-4000-8000-000000000d02";
const OFFICE_B = "00000000-cccc-4000-8000-000000000d03";
const FY = "2029-30";

function envelope(payload: AllocationDistributionCreatePayload): CommandEnvelope<AllocationDistributionCreatePayload> {
  return {
    messageId: randomUUID(),
    type: "finance.budget.distribution.create",
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    timestamp: new Date().toISOString(),
    schemaVersion: "1.0",
    payload,
  };
}

async function seedHead(): Promise<void> {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "SVC-033-LOCK-RACE-HEAD", name: "distribution lock-race test head",
    level: 1, createdBy: ACTOR, updatedBy: ACTOR,
  }).onConflictDoNothing());
}

async function seedAllocation(allocatedMinor: bigint): Promise<string> {
  const id = randomUUID();
  await scoped(TENANT, (tx) => tx.insert(financeBudgetAllocation).values({
    id, tenantId: TENANT, headId: HEAD, fy: FY, allocatedMinor,
    committedMinor: 0n, actualMinor: 0n, currency: "INR",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}

async function cleanup(): Promise<void> {
  await scoped(TENANT, (tx) => tx.delete(financeAllocationDistributions).where(eq(financeAllocationDistributions.fy, FY)));
  await scoped(TENANT, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.headId, HEAD)));
}

beforeAll(async () => { await seedHead(); });
afterAll(async () => {
  await cleanup();
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD))).catch(() => {});
  await sqlClient.end();
});

/**
 * Runs two concurrent handleAllocationDistributionCreate() calls against the
 * same allocation with a forced overlap (see file header). Returns the
 * settled results plus the persisted rows so callers can assert both the
 * per-call outcomes and the final invariant.
 */
async function raceTwoDistributions(allocationId: string, amountEachMinor: number) {
  const p1: AllocationDistributionCreatePayload = {
    id: randomUUID(), tenantId: TENANT, allocationId,
    fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_A, amountMinor: amountEachMinor, currency: "INR",
  };
  const p2: AllocationDistributionCreatePayload = {
    id: randomUUID(), tenantId: TENANT, allocationId,
    fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_B, amountMinor: amountEachMinor, currency: "INR",
  };

  let signalArrived: () => void = () => {};
  const arrived = new Promise<void>((resolve) => { signalArrived = resolve; });
  let releaseA: () => void = () => {};
  const gate = new Promise<void>((resolve) => { releaseA = resolve; });

  const a = runWithTenant(TENANT, () => handleAllocationDistributionCreate(envelope(p1), {
    afterSumRead: async () => { signalArrived(); await gate; },
  }));
  // Don't start B until A has genuinely captured its (about-to-become-stale)
  // view of the distributed sum and parked itself in the TOCTOU window.
  await arrived;
  const b = runWithTenant(TENANT, () => handleAllocationDistributionCreate(envelope(p2)));
  // Generous, one-directional upper bound — see file header. Not a race B
  // might win; a margin for B to have either finished (broken lock) or
  // parked itself waiting on A's still-held row lock (intact lock).
  await new Promise((resolve) => setTimeout(resolve, 300));
  releaseA();

  const results = await Promise.allSettled([a, b]);
  const rows = await scoped(TENANT, (tx) => tx.select().from(financeAllocationDistributions)
    .where(eq(financeAllocationDistributions.allocationId, allocationId)));
  const persistedMinor = rows.reduce((acc, r) => acc + BigInt(r.amountMinor as unknown as string), 0n);
  return { results, rows, persistedMinor };
}

describe("SVC-033 allocation-distribution consumer — FOR UPDATE lock race (deterministic)", () => {
  it("forces genuine overlap: the row lock serialises the two transactions and the allocation is never jointly overdrawn", async () => {
    await cleanup();
    // 600M + 600M = 1200M > 1000M allocated: at most one may persist.
    const allocationId = await seedAllocation(1000000000n);

    const { results, rows, persistedMinor } = await raceTwoDistributions(allocationId, 600000000);

    // Forced overlap + an intact lock means this is no longer a "maybe":
    // exactly one call succeeds, the other is rejected by the app-level
    // over-allocation guard once it observes the winner's committed insert.
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<void> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason)).toContain("DISTRIBUTION_EXCEEDS_ALLOCATION");

    expect(rows.length).toBe(1);
    expect(persistedMinor <= 1000000000n).toBe(true);
    expect(persistedMinor).toBe(600000000n);
  });

  it("control: two non-conflicting concurrent distributions both persist correctly under the same forced-overlap harness", async () => {
    await cleanup();
    // 400M + 400M = 800M <= 1000M allocated: both may legitimately persist.
    // Proves the harness/lock don't just block everything — a real race that
    // fits within headroom still lets both requests through.
    const allocationId = await seedAllocation(1000000000n);

    const { results, rows, persistedMinor } = await raceTwoDistributions(allocationId, 400000000);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(rows.length).toBe(2);
    expect(persistedMinor).toBe(800000000n);
  });
});
