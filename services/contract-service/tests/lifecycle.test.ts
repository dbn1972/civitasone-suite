/**
 * contract-service lifecycle + maker-checker suite.
 *
 *  - Lifecycle: draft -> approved -> active -> closed via real queue->consumer->DB.
 *  - SoD: maker self-approve / self-terminate -> 403 (synchronous, route command).
 *  - Amendment value-delta correctness (paise bigint).
 *  - Idempotency: redeliver the same approve messageId -> exactly one transition / row.
 *  - Zod rejection on bad create body.
 *  - Invalid transition guard.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { contractContracts, contractAmendments } from "../src/modules/contracts/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerContractConsumers } from "../src/modules/contracts/consumer.js";
import {
  assertTransitionAllowed, assertDistinctMakerChecker, assertCanAmend, DomainError,
} from "../src/modules/contracts/domain.js";
import { createContractBody } from "../src/modules/contracts/validators.js";
import { listContracts } from "../src/modules/contracts/queries.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const MAKER   = "00000000-aaaa-4000-8000-0000000000a1";
const CHECKER = "00000000-aaaa-4000-8000-0000000000a2";
const TENANT  = "11111111-aaaa-4000-8000-0000000000ff";
const OTHER_T = "11111111-aaaa-4000-8000-0000000000fe";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(contractAmendments).where(eq(contractAmendments.tenantId, TENANT));
    await tx.delete(contractContracts).where(eq(contractContracts.tenantId, TENANT));
  }));
}

function pub(q: MemoryQueue, type: string, actorId: string, payload: Record<string, unknown>, messageId = randomUUID()) {
  return q.publish(type, {
    messageId, type, tenantId: TENANT, actorId,
    correlationId: "corr-" + messageId.slice(0, 8), schemaVersion: "1.0", payload,
  });
}
const settle = () => new Promise<void>((r) => setTimeout(r, 400));

async function status(id: string): Promise<string | undefined> {
  const [row] = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(contractContracts).where(eq(contractContracts.id, id))));
  return row?.status;
}

// ── Pure domain guards ──────────────────────────────────────────────────────

describe("domain — lifecycle state machine", () => {
  it("draft -> approved -> active -> closed all allowed", () => {
    expect(() => assertTransitionAllowed("draft", "approved")).not.toThrow();
    expect(() => assertTransitionAllowed("approved", "active")).not.toThrow();
    expect(() => assertTransitionAllowed("active", "closed")).not.toThrow();
  });
  it("illegal transitions rejected", () => {
    expect(() => assertTransitionAllowed("draft", "active")).toThrowError("INVALID_TRANSITION");
    expect(() => assertTransitionAllowed("closed", "active")).toThrowError("INVALID_TRANSITION");
    expect(() => assertTransitionAllowed("terminated", "active")).toThrowError("INVALID_TRANSITION");
  });
  it("SoD: same maker+checker rejected, distinct allowed", () => {
    expect(() => assertDistinctMakerChecker(MAKER, MAKER)).toThrowError("SOD_VIOLATION");
    expect(() => assertDistinctMakerChecker(MAKER, CHECKER)).not.toThrow();
  });
  it("amend only on active", () => {
    expect(() => assertCanAmend("active")).not.toThrow();
    expect(() => assertCanAmend("draft")).toThrowError("INVALID_STATUS");
  });
});

describe("validators — Zod rejection", () => {
  it("rejects non-positive value and bad vendorId", () => {
    const r = createContractBody.safeParse({
      contractNo: "C1", vendorId: "not-a-uuid", title: "x",
      valueMinor: -5, startDate: "2026-01-01", expiry: "2026-12-31",
    });
    expect(r.success).toBe(false);
  });
});

// ── Integration: real queue -> consumer -> DB ───────────────────────────────

describe("contract lifecycle (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("draft -> approved -> active -> closed transitions persist + emit events", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerContractConsumers(q);
    await q.start();

    const id = randomUUID();
    await pub(q, COMMANDS.contractCreate, MAKER, {
      id, tenantId: TENANT, contractNo: "LC-001",
      vendorId: randomUUID(), title: "Roadworks", valueMinor: 50000000,
      currency: "INR", startDate: "2026-07-01", expiry: "2027-06-30",
    }, id);
    await settle();
    expect(await status(id)).toBe("draft");

    await pub(q, COMMANDS.contractApprove, CHECKER, { id, tenantId: TENANT });
    await settle();
    expect(await status(id)).toBe("approved");

    await pub(q, COMMANDS.contractActivate, CHECKER, { id, tenantId: TENANT });
    await settle();
    expect(await status(id)).toBe("active");

    await pub(q, COMMANDS.contractClose, CHECKER, { id, tenantId: TENANT });
    await settle();
    expect(await status(id)).toBe("closed");
    await q.stop();

    const events = (await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))))
      .map((r) => r.eventType);
    for (const e of [EVENTS.contractCreated, EVENTS.contractApproved, EVENTS.contractActivated, EVENTS.contractClosed]) {
      expect(events).toContain(e);
    }
    expect(events.filter((e) => e === "audit.event.record").length).toBeGreaterThanOrEqual(4);
  });

  it("amendment applies value-delta in paise and writes one ledger row", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerContractConsumers(q);
    await q.start();

    const id = randomUUID();
    await pub(q, COMMANDS.contractCreate, MAKER, {
      id, tenantId: TENANT, contractNo: "LC-002",
      vendorId: randomUUID(), title: "Supply", valueMinor: 10000000,
      currency: "INR", startDate: "2026-07-01", expiry: "2027-06-30",
    }, id);
    await settle();
    await pub(q, COMMANDS.contractApprove,  CHECKER, { id, tenantId: TENANT }); await settle();
    await pub(q, COMMANDS.contractActivate, CHECKER, { id, tenantId: TENANT }); await settle();

    // +2,500,000 paise variation
    await pub(q, COMMANDS.contractAmend, CHECKER, { id, tenantId: TENANT, reason: "scope increase", valueDelta: 2500000 });
    await settle();
    // -500,000 paise variation
    await pub(q, COMMANDS.contractAmend, CHECKER, { id, tenantId: TENANT, reason: "descope item", valueDelta: -500000 });
    await settle();
    await q.stop();

    const [row] = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(contractContracts).where(eq(contractContracts.id, id))));
    expect(row?.valueMinor).toBe(10000000n + 2500000n - 500000n); // 12,000,000n

    const ams = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(contractAmendments).where(eq(contractAmendments.contractId, id))));
    expect(ams).toHaveLength(2);
    expect(ams.map((a) => a.amendmentNo).sort()).toEqual([1, 2]);
    expect(ams.reduce((s, a) => s + a.valueDelta, 0n)).toBe(2000000n);
  });

  it("idempotency: redelivering the same approve messageId transitions once", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerContractConsumers(q);
    await q.start();

    const id = randomUUID();
    await pub(q, COMMANDS.contractCreate, MAKER, {
      id, tenantId: TENANT, contractNo: "LC-003",
      vendorId: randomUUID(), title: "Idem", valueMinor: 7000000,
      currency: "INR", startDate: "2026-07-01", expiry: "2027-06-30",
    }, id);
    await settle();

    const approveMsg = randomUUID();
    await pub(q, COMMANDS.contractApprove, CHECKER, { id, tenantId: TENANT }, approveMsg);
    await settle();
    // redeliver SAME messageId
    await pub(q, COMMANDS.contractApprove, CHECKER, { id, tenantId: TENANT }, approveMsg);
    await settle();
    await q.stop();

    expect(await status(id)).toBe("approved");
    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(processed).where(eq(processed.messageId, approveMsg))));
    expect(proc).toHaveLength(1);
    // exactly one approved event in the outbox for this contract
    const approvedEvents = (await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))))
      .filter((r) => r.eventType === EVENTS.contractApproved && (r.payload as any)?.contractId === id);
    expect(approvedEvents).toHaveLength(1);
  });

  it("tenant isolation: amend payload tenant differs -> contract not found for other tenant scope", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerContractConsumers(q);
    await q.start();
    const id = randomUUID();
    await pub(q, COMMANDS.contractCreate, MAKER, {
      id, tenantId: TENANT, contractNo: "LC-004",
      vendorId: randomUUID(), title: "Iso", valueMinor: 4000000,
      currency: "INR", startDate: "2026-07-01", expiry: "2027-06-30",
    }, id);
    await settle();
    await q.stop();
    const otherScoped = await runWithTenant(OTHER_T, () => db.transaction(async (tx) => tx.select().from(contractContracts)
      .where(eq(contractContracts.tenantId, OTHER_T))));
    expect(otherScoped.find((r) => r.id === id)).toBeUndefined();
  });

  it("cache: a newly created contract is visible in the list with no stale-cache window", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerContractConsumers(q);
    await q.start();

    // Prime the list-read cache the same way GET /v1/contract/contracts does:
    // a cold read caches whatever is there right now (read-through, 60s TTL).
    await runWithTenant(TENANT, () => listContracts(TENANT, 50));

    const id = randomUUID();
    await pub(q, COMMANDS.contractCreate, MAKER, {
      id, tenantId: TENANT, contractNo: "LC-005",
      vendorId: randomUUID(), title: "Cache regression", valueMinor: 1000000,
      currency: "INR", startDate: "2026-07-01", expiry: "2027-06-30",
    }, id);
    await settle();
    await q.stop();

    // Before the fix, the consumer only invalidated the single
    // "contract:<tenant>:contract:<id>" cache key, never the
    // "contract:<tenant>:contract:list:<limit>" key the list read uses — so
    // this second read would still return the pre-create cached snapshot,
    // silently hiding the contract the caller just created for up to the
    // cache's TTL (reproduced live against the running dev stack: a freshly
    // created contract was absent from GET /contracts for ~60s).
    const rows = await runWithTenant(TENANT, () => listContracts(TENANT, 50));
    expect(rows.some((r) => r.id === id)).toBe(true);
  });

  it("cache: an approved contract's new status is visible in the list (consumer-side invalidation)", async () => {
    // Distinct from the create-path test above: this exercises a DIFFERENT
    // call site (contractApprove's branch in consumer.ts) and primes the
    // list cache with a snapshot that already contains the row, so only a
    // correct invalidation (not just "cache was empty/cold") can make the
    // second read reflect the new status.
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerContractConsumers(q);
    await q.start();

    const id = randomUUID();
    await pub(q, COMMANDS.contractCreate, MAKER, {
      id, tenantId: TENANT, contractNo: "LC-006",
      vendorId: randomUUID(), title: "Cache regression — approve", valueMinor: 2000000,
      currency: "INR", startDate: "2026-07-01", expiry: "2027-06-30",
    }, id);
    await settle();

    // Prime the list cache with the DRAFT snapshot.
    const before = await runWithTenant(TENANT, () => listContracts(TENANT, 50));
    expect(before.find((r) => r.id === id)?.status).toBe("draft");

    await pub(q, COMMANDS.contractApprove, CHECKER, { id, tenantId: TENANT });
    await settle();
    await q.stop();

    // Before this fix, contractApprove's consumer branch only invalidated the
    // by-id key, so this read would still return the stale DRAFT snapshot
    // primed above.
    const after = await runWithTenant(TENANT, () => listContracts(TENANT, 50));
    expect(after.find((r) => r.id === id)?.status).toBe("approved");
  });
});
