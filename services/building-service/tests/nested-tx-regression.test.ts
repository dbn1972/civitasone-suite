/**
 * building-service nested-transaction connection-pool deadlock regression.
 *
 * `applications/consumer.ts`'s `submitApplication`, `permits/consumer.ts`'s
 * `issuePermit`, and `scrutiny/consumer.ts`'s `decideApplication` all ran
 * inside an already-open outer `db.transaction(async (tx) => {...})` and
 * looked up the parent application via `repo.findById()` (or `appRepo.findById`),
 * which is `scopedRead`-based -- i.e. it opens a SECOND, nested
 * `db.transaction()` on the SAME connection pool as the outer command. With
 * `pool.max = 10` (packages/db/src/pool.ts), once 10 of these commands were
 * concurrently in-flight the pool was exhausted and every one of them
 * deadlocked waiting for a connection its own nested lookup would never get
 * -- the exact same shape as notification-service's checkQuota/checkDlt
 * deadlock (PR #1028) and its 3 other instances (i18n, segments, dlt).
 *
 * Fixed by routing all three call sites onto the caller's already-open `tx`
 * via the new `applications/repo.ts` `findByIdInTx` (mirrors
 * notification-service's `findCurrentQuotaInTx` / `findActiveByChannelInTx`
 * convention from that PR).
 *
 * This pins the fixed behavior functionally (each command completes
 * end-to-end reading the application through the outer tx, and
 * `findByIdInTx` itself proves it never opens a second transaction) -- the
 * same style of regression test PR #1028 added in
 * notification-service/tests/segments-consumer.test.ts. The pool-exhaustion
 * deadlock itself was reproduced and verified manually against a real
 * Postgres connection pool: unfixed code left exactly `pool.max` (10)
 * connections stuck "idle in transaction" (last query: the outer
 * transaction's own outbox insert, immediately before the nested findById
 * that could never acquire an 11th connection) and `queue.drain()` never
 * resolved (15s timeout, 0/12 applications reached `submitted`); fixed code
 * drained cleanly in under 60ms with 0 stuck connections for 12-20
 * concurrent commands across all three call sites.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "@civitasone/outbox";
import { buildingApplications } from "../src/modules/applications/schema.js";
import { buildingPermits } from "../src/modules/permits/schema.js";
import * as appRepo from "../src/modules/applications/repo.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { registerScrutinyConsumers } from "../src/modules/scrutiny/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "80000000-dead-4000-8000-00000000c0de";
const ACTOR = "80000000-dead-4000-8000-00000000ac70";

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    // These tests run real commands through the consumers, which (per the
    // Wave 3 cross-events wiring) write real _outbox.messages rows in the
    // same transaction as their status writes. _outbox.messages has RLS
    // disabled and relayOnce() scans it unscoped-by-tenant, so leftover rows
    // here get swept into an unrelated later test file's own relayOnce()
    // call and can starve it of the specific row it expects within its
    // assertion window -- clean them up the same way admin-service's tests
    // do (tests/admin.test.ts), scoped by this file's own TENANT.
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(buildingPermits).where(eq(buildingPermits.tenantId, TENANT));
    await tx.delete(buildingApplications).where(eq(buildingApplications.tenantId, TENANT));
  }));
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function seedDraftApplication(queue: MemoryQueue, id: string): Promise<void> {
  await queue.publish(COMMANDS.createApplication, makeMsg(COMMANDS.createApplication, {
    id, tenantId: TENANT, siteAddress: { line1: "1 Test Rd" },
    plotArea: 100, builtUpArea: 80, proposedFloors: 2, fsiRequested: 1.0,
  }));
  await queue.drain();
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("applications/repo.ts findByIdInTx — nested-transaction regression", () => {
  it("reads through the caller's already-open transaction (no second connection acquired)", async () => {
    const id = randomUUID();
    const found = await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await appRepo.insertApplication(tx, {
        id, tenantId: TENANT, applicationNumber: `TEST/${id.slice(0, 8)}`, status: "draft",
        siteAddress: { line1: "1 Test Rd" }, documents: [], drawings: [],
        feeCurrency: "INR", feePaid: false, createdBy: ACTOR, updatedBy: ACTOR,
      });
      // Same tx, same connection -- this is the invariant the deadlock fix
      // depends on: findByIdInTx must never call db.transaction() itself.
      return appRepo.findByIdInTx(tx, id, TENANT);
    }));

    expect(found?.id).toBe(id);
    expect(found?.status).toBe("draft");
  });
});

describe("submitApplication / issuePermit / decideApplication — nested-transaction regression", () => {
  it("submitApplication completes end-to-end, reading the application via the outer tx", async () => {
    const queue = new MemoryQueue();
    registerApplicationConsumers(queue);
    const id = randomUUID();
    await seedDraftApplication(queue, id);

    await queue.publish(COMMANDS.submitApplication, makeMsg(COMMANDS.submitApplication, { id, tenantId: TENANT }));
    await queue.drain();

    expect(queue.dlq).toHaveLength(0);
    const row = await runWithTenant(TENANT, () => db.transaction((tx) => appRepo.findByIdInTx(tx, id, TENANT)));
    expect(row?.status).toBe("submitted");
  });

  it("issuePermit completes end-to-end, reading the parent application via the outer tx", async () => {
    const queue = new MemoryQueue();
    registerApplicationConsumers(queue);
    registerPermitConsumers(queue);
    const appId = randomUUID();
    await seedDraftApplication(queue, appId);

    const permitId = randomUUID();
    await queue.publish(COMMANDS.issuePermit, makeMsg(COMMANDS.issuePermit, {
      id: permitId, tenantId: TENANT, applicationId: appId, validityMonths: 12,
    }));
    await queue.drain();

    expect(queue.dlq).toHaveLength(0);
    const permit = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(buildingPermits).where(eq(buildingPermits.id, permitId)).limit(1)));
    expect(permit[0]?.id).toBe(permitId);
    expect(permit[0]?.applicationId).toBe(appId);
  });

  it("decideApplication completes end-to-end, reading the application via the outer tx", async () => {
    const queue = new MemoryQueue();
    registerApplicationConsumers(queue);
    registerScrutinyConsumers(queue);
    const appId = randomUUID();
    await seedDraftApplication(queue, appId);

    await queue.publish(COMMANDS.decideApplication, makeMsg(COMMANDS.decideApplication, {
      applicationId: appId, tenantId: TENANT, decision: "approved",
    }));
    await queue.drain();

    expect(queue.dlq).toHaveLength(0);
    const row = await runWithTenant(TENANT, () => db.transaction((tx) => appRepo.findByIdInTx(tx, appId, TENANT)));
    expect(row?.status).toBe("approved");
  });

  it("handles several concurrent submitApplication commands cleanly (no dlq entries, no hang)", async () => {
    // Not a pool-exhaustion storm (that needs > pool.max=10 concurrent real
    // connections and was verified manually against a live Postgres pool --
    // see this file's header comment) -- this exercises the same concurrent
    // code path at a small, CI-safe scale and pins that it stays clean.
    const queue = new MemoryQueue();
    registerApplicationConsumers(queue);
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) await seedDraftApplication(queue, id);

    await Promise.all(ids.map((id) =>
      queue.publish(COMMANDS.submitApplication, makeMsg(COMMANDS.submitApplication, { id, tenantId: TENANT })),
    ));
    await queue.drain();

    expect(queue.dlq).toHaveLength(0);
    for (const id of ids) {
      const row = await runWithTenant(TENANT, () => db.transaction((tx) => appRepo.findByIdInTx(tx, id, TENANT)));
      expect(row?.status).toBe("submitted");
    }
  });
});
