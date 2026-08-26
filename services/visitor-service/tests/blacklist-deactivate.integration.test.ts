/**
 * Integration test (Fix 3, new coverage): the `blacklistDeactivate` command
 * added alongside the expiry fix — before this fix there was no route or
 * command anywhere in this module that could lift/remove a blacklist entry
 * (topics.ts only defined blacklistAdd/blacklistApprove).
 *
 * Drives the real consumer (registerBlacklistConsumers) against a real
 * Postgres-backed blacklist_entries row and the real (in-memory, per
 * vitest.config.ts's CACHE_DRIVER=memory) screening store, proving:
 *   - approving an entry makes isBlacklisted() true
 *   - deactivating it (by a distinct actor) flips the DB row to `archived`
 *     AND makes isBlacklisted() false immediately (no need to wait for the
 *     expiry-driven lazy eviction from Fix 3's screening-store change)
 *   - maker-checker (Property 18) applies symmetrically to deactivation:
 *     the same actor who created the entry cannot also deactivate it
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead, sqlClient } from "../src/shared/db.js";
import { blacklistEntries } from "../src/modules/blacklist/schema.js";
import { registerBlacklistConsumers } from "../src/modules/blacklist/consumer.js";
import { isBlacklisted, setScreeningStoreForTests } from "../src/modules/blacklist/screening-store.js";
import { identityDocHash } from "../src/modules/blacklist/blind-index.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();

beforeEach(() => {
  setScreeningStoreForTests(null);
});

afterAll(async () => {
  await sqlClient.end();
});

async function seedEntry(id: string, hash: string): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.insert(blacklistEntries).values({
        id, tenantId: TENANT, personName: "Deactivate Test Subject",
        identityDocHash: hash, reason: "audit fixture", status: "pending",
        createdBy: MAKER, updatedBy: MAKER,
      }),
    ),
  );
}

async function readEntry(id: string) {
  const rows = await runWithTenant(TENANT, () =>
    scopedRead((tx) => tx.select().from(blacklistEntries).where(and(eq(blacklistEntries.id, id), eq(blacklistEntries.tenantId, TENANT)))),
  );
  return rows[0];
}

async function cleanup(id: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(blacklistEntries).where(eq(blacklistEntries.id, id))));
}

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  // visitor.* tables are FORCE ROW LEVEL SECURITY; under the NOBYPASSRLS
  // visitor_svc role a consumer's db.transaction() only sees/affects its
  // tenant's rows when app.tenant_id is set. In production this GUC-scoping
  // is applied by a single wrap in worker.ts BEFORE any register*Consumers
  // call — reproduce that exact wrap here, matching the convention
  // established in identity-verify-ownership.integration.test.ts /
  // turnstile-cross-gate-checkin.integration.test.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));

  registerBlacklistConsumers(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, actorId: string, waitMs = 400): Promise<void> {
  await queue.publish(topic, {
    type: topic, tenantId: TENANT, actorId, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  });
  await new Promise((r) => setTimeout(r, waitMs));
}

describe("blacklistDeactivate — lifts an active entry (Fix 3)", () => {
  it("approve then deactivate: isBlacklisted() flips true -> false, status flips active -> archived", async () => {
    const id = randomUUID();
    const hash = identityDocHash(`deactivate-fixture-${id}`, "aadhaar");
    await seedEntry(id, hash);

    const queue = freshQueue();

    await publishAndFlush(queue, COMMANDS.blacklistApprove, { id, tenantId: TENANT }, CHECKER);
    const afterApprove = await readEntry(id);
    expect(afterApprove?.status).toBe("active");
    expect(await isBlacklisted(TENANT, hash)).toBe(true);

    await publishAndFlush(queue, COMMANDS.blacklistDeactivate, { id, tenantId: TENANT }, CHECKER);
    const afterDeactivate = await readEntry(id);
    expect(afterDeactivate?.status).toBe("archived");
    expect(await isBlacklisted(TENANT, hash)).toBe(false);

    await cleanup(id);
  }, 15000);

  it("maker-checker: the entry's own creator cannot deactivate it (self-deactivation rejected)", async () => {
    const id = randomUUID();
    const hash = identityDocHash(`self-deactivate-fixture-${id}`, "aadhaar");
    await seedEntry(id, hash);

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.blacklistApprove, { id, tenantId: TENANT }, CHECKER);
    expect(await isBlacklisted(TENANT, hash)).toBe(true);

    // MAKER is the entry's createdBy — same actor attempting to deactivate
    // their own entry violates Property 18 (segregation of duties) and is
    // rejected by the consumer's assertDistinctMakerChecker check. The
    // DomainError is non-retryable-classified the same way blacklistApprove's
    // self-approval rejection is, so give MemoryQueue's retry/backoff cycle
    // room to finish before asserting (mirrors blacklist-consumer.test.ts's
    // self-approval test).
    await publishAndFlush(queue, COMMANDS.blacklistDeactivate, { id, tenantId: TENANT }, MAKER, 700);

    const stillActive = await readEntry(id);
    expect(stillActive?.status).toBe("active");
    expect(await isBlacklisted(TENANT, hash)).toBe(true);

    await cleanup(id);
  }, 15000);
});
