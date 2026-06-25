/**
 * 10-T2 — Real cross-service E2E event chains (finance is the downstream svc).
 *
 * Unlike the per-service consumer tests (which publish the consumed topic onto
 * an in-process queue the SAME service owns), these tests:
 *   1. register the REAL `registerIntegrationConsumers(queue)` from
 *      finance-service on a shared MemoryQueue,
 *   2. publish the PRODUCER service's event (payroll / grant / audit),
 *   3. assert the downstream finance service reacts by emitting its next event
 *      (captured by a real subscriber on the queue) or by writing the expected
 *      row (captured by the in-memory db stub).
 *
 * The producer→consumer hop is therefore real: publish → MemoryQueue delivers →
 * real finance handler runs → its outbox enqueue re-publishes downstream →
 * a real subscriber consumes it. No regex/topic-string matching.
 *
 * DB is stubbed entirely in-memory (see harness.ts) so this runs in CI with no
 * Postgres. We mock finance-service's `shared/db.js` (transactional fake) and
 * `shared/outbox.js` (relay-on-enqueue + in-memory inbox).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// Replace finance-service's DB layer with the in-memory transactional fake.
vi.mock("../../services/finance-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
});

// Replace finance-service's transactional outbox/inbox. `enqueue` re-publishes
// onto the shared queue (the cross-service hop); `markProcessed` is in-memory.
vi.mock("../../services/finance-service/src/shared/outbox.js", async () => {
  const h = await import("./harness.js");
  return {
    enqueue: h.mockEnqueue,
    markProcessed: h.mockMarkProcessed,
    // inert extras so any incidental import keeps working
    outboxMessages: {},
    processed: {},
    outboxSchema: {},
    relayOnce: async () => 0,
    startRelay: () => ({}) as unknown,
  };
});

// Imported AFTER the mocks are declared (vi.mock is hoisted above imports).
const { registerIntegrationConsumers } = await import(
  "../../services/finance-service/src/modules/integrations/consumer.js"
);

const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "22222222-bbbb-4000-8000-000000000001";

function envelope(messageId: string, type: string, payload: Record<string, unknown>) {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${messageId.slice(0, 8)}`,
    schemaVersion: "1.0",
    payload,
  };
}

let harness: ChainHarness;

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  // Wire the REAL downstream finance consumers onto the shared bus.
  registerIntegrationConsumers(harness.queue);
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("Cross-service chain 1: payroll.run.approved → finance.gl.post", () => {
  it("payroll approval makes finance post a balanced salary GL journal", async () => {
    // Subscribe BEFORE publishing so the downstream event is captured.
    const glPosted = harness.nextEvent("finance.gl.post");

    await harness.queue.publish(
      "payroll.run.approved",
      envelope("aaaaaaaa-0001-4000-8000-000000000001", "payroll.run.approved", {
        runId: "99999999-0001-4000-8000-000000000001",
        month: "2025-04",
        totalGrossMinor: "1000000",
        totalNetMinor: "800000",
      }),
    );

    const msg = await glPosted;
    expect(msg.type).toBe("finance.gl.post");

    const p = msg.payload as { type: string; voucherNo: string; lines: Array<{ accountCode: string; debitMinor: string | number; creditMinor: string | number }> };
    expect(p.type).toBe("payroll_accrual");
    expect(p.voucherNo).toContain("PAY/2025-04/");

    // Double-entry must balance: total debits == total credits.
    const debit = p.lines.reduce((s, l) => s + Number(l.debitMinor), 0);
    const credit = p.lines.reduce((s, l) => s + Number(l.creditMinor), 0);
    expect(debit).toBe(1000000);
    expect(credit).toBe(1000000);
    // gross debit, net + statutory credit split (800000 + 200000)
    expect(Number(p.lines.find((l) => l.accountCode === "5001")?.debitMinor)).toBe(1000000);
    expect(Number(p.lines.find((l) => l.accountCode === "2101")?.creditMinor)).toBe(800000);
    expect(Number(p.lines.find((l) => l.accountCode === "2102")?.creditMinor)).toBe(200000);
  });
});

describe("Cross-service chain 2: grant.uc.submitted → finance.uc.reconciled", () => {
  it("UC submission makes finance emit a reconciliation event (07-T1 wiring)", async () => {
    const reconciled = harness.nextEvent("finance.uc.reconciled");

    await harness.queue.publish(
      "grant.uc.submitted",
      envelope("aaaaaaaa-0002-4000-8000-000000000001", "grant.uc.submitted", {
        ucId: "88888888-0001-4000-8000-000000000001",
        applicationId: "77777777-0001-4000-8000-000000000001",
        disbursementId: "66666666-0001-4000-8000-000000000001",
        utilisedMinor: 500000,
      }),
    );

    const msg = await reconciled;
    expect(msg.type).toBe("finance.uc.reconciled");

    const p = msg.payload as { ucId: string; applicationId: string; disbursementId?: string; utilisedMinor: string; outcome: string };
    expect(p.outcome).toBe("reconciled");
    expect(p.ucId).toBe("88888888-0001-4000-8000-000000000001");
    expect(p.applicationId).toBe("77777777-0001-4000-8000-000000000001");
    expect(p.utilisedMinor).toBe("500000");
  });
});

describe("Cross-service chain 3: audit.para.pending_recovery → finance records recovery", () => {
  it("a pending-recovery audit para makes finance write a recovery row + emit audit event", async () => {
    // This chain WRITES a row (no downstream business event), so assert on the
    // captured insert AND on the audit.event.record the consumer emits.
    const auditEvent = harness.nextEvent("audit.event.record");

    await harness.queue.publish(
      "audit.para.pending_recovery",
      envelope("aaaaaaaa-0003-4000-8000-000000000001", "audit.para.pending_recovery", {
        paraId: "55555555-0001-4000-8000-000000000001",
        deptRef: "Public Works Dept",
        amountInvolvedMinor: 250000,
      }),
    );

    const msg = await auditEvent;
    const ap = msg.payload as { service: string; action: string; resourceType: string };
    expect(ap.service).toBe("finance");
    expect(ap.action).toBe("recovery_flag");
    expect(ap.resourceType).toBe("finance_audit_para");

    // The finance audit-paras row the consumer "would write".
    const recovery = harness.inserts.find((i) => i.row.status === "pending_recovery");
    expect(recovery, "expected a finance_audit_paras recovery row to be written").toBeDefined();
    expect(recovery!.row.dept).toBe("Public Works Dept");
    expect(recovery!.row.moneyValueMinor).toBe(250000n);
    expect(String(recovery!.row.paraNo)).toContain("AUDIT-");
  });
});

describe("Idempotency across the hop", () => {
  // A redelivered producer event must not fan out twice downstream. Both the
  // bus (messageId dedupe) and the consumer's inbox (markProcessed) enforce
  // this; either way the downstream service must emit exactly one event.
  it("a redelivered producer event is processed once", async () => {
    const seen: string[] = [];
    harness.queue.subscribe("finance.gl.post", async () => {
      seen.push("posted");
    });

    const dup = envelope("aaaaaaaa-0004-4000-8000-000000000001", "payroll.run.approved", {
      runId: "99999999-0002-4000-8000-000000000001",
      month: "2025-05",
      totalGrossMinor: "500000",
      totalNetMinor: "400000",
    });

    await harness.queue.publish("payroll.run.approved", dup);
    await harness.queue.publish("payroll.run.approved", dup);
    await new Promise((r) => setTimeout(r, 300));

    // Same messageId delivered twice → markProcessed gates the second → one post.
    expect(seen).toHaveLength(1);
  });
});
