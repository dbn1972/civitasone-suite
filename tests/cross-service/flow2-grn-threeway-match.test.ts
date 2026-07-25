/**
 * PHASE-3 FLOW 2 — Payment → 3-way-match (PO ↔ GRN ↔ Invoice).
 *
 * NOTE ON DIRECTION: the brief framed this as "finance bill.create →
 * procurement 3-way-match", but the REAL architecture is the reverse — the
 * three-way match lives in FINANCE and is triggered by procurement's GRN event:
 *   Emitter  : procurement EVENTS.grnAccepted          = "procurement.grn.accepted"
 *   Consumer : finance     CONSUMED_EVENTS.grnAccepted = "procurement.grn.accepted"
 *   finance then validates PO↔GRN↔invoice and emits
 *     "procurement.three_way_match.passed" / ".failed".
 *
 * (A) EMIT/MATCH — drive the REAL finance payments consumer with a
 *     procurement.grn.accepted event and assert the 3-way-match RESULT event is
 *     written to the outbox.
 * (B) CONSUME — the REAL finance payments registration subscribes to the exact
 *     "procurement.grn.accepted" topic procurement emits.
 *
 * VERDICT: WIRED (topic strings match exactly; match logic executes finance-side).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ChainHarness, setCurrentHarness } from "../integration/harness.js";
import { RecordingQueue, envelope, collect, TENANT } from "./_helpers.js";
import { EVENTS as PROC_EVENTS } from "../../services/procurement-service/src/topics.js";
import { CONSUMED_EVENTS as FIN_CONSUMED } from "../../services/finance-service/src/topics.js";

// ── finance-service (consumer + 3-way-match executor) data layer ────────────
vi.mock("../../services/finance-service/src/shared/db.js", async () => {
  const h = await import("../integration/harness.js");
  return { db: h.mockDb, sqlClient: {} };
});
vi.mock("../../services/finance-service/src/shared/outbox.js", async () => {
  const h = await import("../integration/harness.js");
  return {
    enqueue: h.mockEnqueue,
    markProcessed: h.mockMarkProcessed,
    outboxMessages: {},
    processed: {},
    outboxSchema: {},
    relayOnce: async () => 0,
    startRelay: () => ({}) as unknown,
  };
});
vi.mock("../../services/finance-service/src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, invalidateResource: async () => {}, makeKey: (...p: string[]) => p.join(":") },
}));

const { registerPaymentsConsumers } = await import(
  "../../services/finance-service/src/modules/payments/consumer.js"
);

const CONSUME_TOPIC = "procurement.grn.accepted";
const RESULT_TOPIC = "procurement.three_way_match.passed";
let harness: ChainHarness;

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  registerPaymentsConsumers(harness.queue);
  await harness.queue.start();
});
afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("FLOW 2 — Payment → 3-way-match (WIRED)", () => {
  it("(A) EMIT/MATCH: procurement.grn.accepted drives finance 3-way match → passed event in outbox", async () => {
    const emitted = collect(harness, RESULT_TOPIC);
    const poId = randomUUID();
    const grnId = randomUUID();

    // poAmountMinor == totalMinor ⇒ 0% variance ⇒ match passes (read-free path).
    await harness.queue.publish(
      CONSUME_TOPIC,
      envelope(randomUUID(), CONSUME_TOPIC, {
        poId,
        grnId,
        vendorId: "dddddddd-0000-4000-8000-000000000001",
        totalMinor: "500000",
        poAmountMinor: "500000",
        tenantId: TENANT,
      }),
    );
    await harness.queue.drain();

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted[0]!.type).toBe(RESULT_TOPIC);
    const p = emitted[0]!.payload as { poId: string; grnId: string; variancePct: number };
    expect(p.poId).toBe(poId);
    expect(p.grnId).toBe(grnId);
    expect(p.variancePct).toBe(0);
  });

  it("(B) CONSUME: finance registers a subscriber for procurement.grn.accepted", () => {
    const rq = new RecordingQueue();
    registerPaymentsConsumers(rq.asQueue());
    expect(rq.subscribedTopics.has(CONSUME_TOPIC)).toBe(true);
  });

  it("emitter and consumer agree on the exact topic string", () => {
    expect(PROC_EVENTS.grnAccepted).toBe(CONSUME_TOPIC);
    expect(FIN_CONSUMED.grnAccepted).toBe(PROC_EVENTS.grnAccepted);
  });
});
