/**
 * CRITICAL (FIXED) — suspending or revoking a Recurring_Pass never blocked it
 * at the gate.
 *
 * ORIGINAL BUG: modules/recurring-pass/consumer.ts's
 * recurringPassSuspend/recurringPassRevoke handlers only ever wrote to the
 * `recurring_passes` table and to their OWN Redis set
 * (recurring-pass/revocation-store.ts, key
 * `visitor:{tid}:recurring_pass:revoked`) — never touched `digital_passes`
 * or digital-pass/revocation-store.ts.
 *
 * But gate verification (modules/check-in/routes.ts's POST
 * /v1/visitor/passes/verify, the ONLY place a scanned QR is actually
 * checked) imports and calls exclusively `../digital-pass/revocation-store.js`'s
 * `isRevoked` — it never imported anything from
 * recurring-pass/revocation-store.ts. The two revocation sets are entirely
 * separate Redis keys tracking entirely separate entities.
 *
 * FIXED: recurring-pass/consumer.ts's suspend/revoke handlers now ALSO call
 * digital-pass/revocation-store.ts's addToRevokedSet(), keyed by the same
 * underlying digital-pass id (`entry.passId`) already used for this
 * module's own set — a single dual-write, not a new "source of truth"
 * concept, so gate verification's existing isRevoked() check (unchanged)
 * now actually sees these revocations.
 *
 * See also recurring-pass-gate-sync-id-mismatch.integration.test.ts for the
 * matching (also fixed) bug in the OFFLINE gate-sync snapshot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const versionedUpdateMock = vi.fn(async () => undefined);

let recurringPassRow: Record<string, unknown> | undefined;

function makeSelectChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

const fakeTx = {
  select: vi.fn(() => makeSelectChain(recurringPassRow ? [recurringPassRow] : [])),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  versionedUpdate: (...args: unknown[]) => versionedUpdateMock(...args),
}));

const { registerRecurringPassConsumers } = await import("../src/modules/recurring-pass/consumer.js");
const { COMMANDS } = await import("../src/topics.js");
// Real revocation stores (both default to an in-memory Set under
// CACHE_DRIVER=memory / no REDIS_URL, per vitest.config.ts) — no mocking, so
// the cross-store gap is proven against genuine module behavior.
const recurringPassRevocation = await import("../src/modules/recurring-pass/revocation-store.js");
const digitalPassRevocation = await import("../src/modules/digital-pass/revocation-store.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const RECURRING_PASS_ID = "33333333-3333-3333-3333-333333333333";
// The underlying digital pass id — this is what actually appears in the
// visitor's scanned QR (`visit_id` claim) and what gate verification's
// isRevoked() check is keyed on.
const UNDERLYING_DIGITAL_PASS_ID = "44444444-4444-4444-4444-444444444444";

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerRecurringPassConsumers(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, waitMs = 20): Promise<void> {
  await queue.publish(topic, { type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1", schemaVersion: "1.0", payload });
  await new Promise((r) => setTimeout(r, waitMs));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  versionedUpdateMock.mockReset().mockResolvedValue(undefined);
  recurringPassRevocation.setRevocationStoreForTests(null);
  digitalPassRevocation.setRevocationStoreForTests(null);

  recurringPassRow = {
    id: RECURRING_PASS_ID, tenantId: TENANT, passId: UNDERLYING_DIGITAL_PASS_ID,
    visitorName: "Contractor Bob", visitorPhone: "9999999999", status: "active",
    issuedBy: ACTOR, version: 1,
  };
});

describe("recurringPassSuspend (FIXED)", () => {
  it("adds the recurring pass to its OWN revocation set AND the canonical digital-pass revocation set gate verification actually checks — both keyed by the underlying digital-pass id", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.recurringPassSuspend, { id: RECURRING_PASS_ID, tenantId: TENANT, reason: "policy violation" });

    // recurring-pass/consumer.ts calls addToRevocationSet(tenantId, entry.passId)
    // AND (FIXED) addToDigitalPassRevokedSet(tenantId, entry.passId).
    await expect(recurringPassRevocation.isRevoked(TENANT, UNDERLYING_DIGITAL_PASS_ID)).resolves.toBe(true);
    await expect(digitalPassRevocation.isRevoked(TENANT, UNDERLYING_DIGITAL_PASS_ID)).resolves.toBe(true);
  });
});

describe("recurringPassRevoke (FIXED)", () => {
  it("adds the recurring pass to its OWN revocation set AND the canonical digital-pass revocation set gate verification actually checks — both keyed by the underlying digital-pass id", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.recurringPassRevoke, { id: RECURRING_PASS_ID, tenantId: TENANT, reason: "terminated" });

    await expect(recurringPassRevocation.isRevoked(TENANT, UNDERLYING_DIGITAL_PASS_ID)).resolves.toBe(true);
    await expect(digitalPassRevocation.isRevoked(TENANT, UNDERLYING_DIGITAL_PASS_ID)).resolves.toBe(true);
  });
});

describe("what SHOULD happen (FIXED)", () => {
  it("suspending a recurring pass also blocks its underlying digital pass at the gate", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.recurringPassSuspend, { id: RECURRING_PASS_ID, tenantId: TENANT, reason: "policy violation" });

    await expect(digitalPassRevocation.isRevoked(TENANT, UNDERLYING_DIGITAL_PASS_ID)).resolves.toBe(true);
  });

  it("revoking a recurring pass also blocks its underlying digital pass at the gate", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.recurringPassRevoke, { id: RECURRING_PASS_ID, tenantId: TENANT, reason: "terminated" });

    await expect(digitalPassRevocation.isRevoked(TENANT, UNDERLYING_DIGITAL_PASS_ID)).resolves.toBe(true);
  });
});
