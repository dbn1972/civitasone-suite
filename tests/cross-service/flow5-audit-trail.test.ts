/**
 * PHASE-3 FLOW 5 — Audit trail (fan-in).
 *
 * SEAM: ANY service mutation → "audit.event.record" in the outbox → consumed by
 * audit-service which records the immutable trail.
 *   Emitters : contract-service, citizen-service (representative) both enqueue
 *              AUDIT_TOPIC = "audit.event.record" on every mutation.
 *   Consumer : audit CONSUME_TOPICS.auditEventRecord = "audit.event.record".
 *
 * (A) EMIT  — drive the REAL contract create + citizen grievance-register
 *     mutations and assert BOTH write an "audit.event.record" to the outbox.
 * (B) CONSUME — the REAL audit registration subscribes to that exact topic.
 *
 * VERDICT: WIRED (many services emit; audit-service subscribes; strings match).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ChainHarness, setCurrentHarness } from "../integration/harness.js";
import { RecordingQueue, envelope, collect, TENANT } from "./_helpers.js";
import { COMMANDS as CONTRACT_COMMANDS } from "../../services/contract-service/src/topics.js";
import { COMMANDS as CIT_COMMANDS } from "../../services/citizen-service/src/topics.js";
import { CONSUME_TOPICS as AUDIT_CONSUME } from "../../services/audit-service/src/topics.js";

const AUDIT_TOPIC = "audit.event.record";

// ── contract-service (representative emitter #1) ────────────────────────────
vi.mock("../../services/contract-service/src/shared/db.js", async () => {
  const h = await import("../integration/harness.js");
  return { db: h.mockDb, sqlClient: {} };
});
vi.mock("../../services/contract-service/src/shared/outbox.js", async () => {
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
vi.mock("../../services/contract-service/src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, invalidateResource: async () => {}, makeKey: (...p: string[]) => p.join(":") },
}));

// ── citizen-service (representative emitter #2) ─────────────────────────────
vi.mock("../../services/citizen-service/src/shared/db.js", async () => {
  const h = await import("../integration/harness.js");
  return { db: h.mockDb, sqlClient: {} };
});
vi.mock("../../services/citizen-service/src/shared/outbox.js", async () => {
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
vi.mock("../../services/citizen-service/src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, invalidateResource: async () => {}, makeKey: (...p: string[]) => p.join(":") },
}));

// ── audit-service (consumer) ────────────────────────────────────────────────
vi.mock("../../services/audit-service/src/shared/db.js", () => ({ db: {}, sqlClient: {} }));
vi.mock("../../services/audit-service/src/shared/outbox.js", () => ({
  enqueue: async () => {},
  markProcessed: async () => true,
}));
vi.mock("../../services/audit-service/src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, invalidateResource: async () => {}, makeKey: (...p: string[]) => p.join(":") },
}));

const { registerContractConsumers } = await import(
  "../../services/contract-service/src/modules/contracts/consumer.js"
);
const { registerGrievanceConsumers } = await import(
  "../../services/citizen-service/src/modules/grievance/consumer.js"
);
const { registerAuditConsumers } = await import(
  "../../services/audit-service/src/modules/events/consumer.js"
);

let harness: ChainHarness;
beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  registerContractConsumers(harness.queue);
  registerGrievanceConsumers(harness.queue);
  await harness.queue.start();
});
afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("FLOW 5 — Audit trail (WIRED)", () => {
  it("(A) EMIT: contract + citizen mutations each write audit.event.record to the outbox", async () => {
    const audits = collect(harness, AUDIT_TOPIC);

    await harness.queue.publish(
      CONTRACT_COMMANDS.contractCreate,
      envelope(randomUUID(), CONTRACT_COMMANDS.contractCreate, {
        id: randomUUID(),
        tenantId: TENANT,
        contractNo: "CTR-2026-0001",
        vendorId: "dddddddd-0000-4000-8000-000000000001",
        title: "Annual maintenance",
        valueMinor: 1000000,
        startDate: "2026-08-01",
        expiry: "2027-07-31",
      }),
    );
    await harness.queue.publish(
      CIT_COMMANDS.grievanceRegister,
      envelope(randomUUID(), CIT_COMMANDS.grievanceRegister, {
        id: randomUUID(),
        tenantId: TENANT,
        citizenId: "cc000000-0000-4000-8000-000000000001",
        category: "roads",
        subject: "Pothole",
        description: "Large pothole on main road",
      }),
    );
    await harness.queue.drain();

    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits.every((m) => m.type === AUDIT_TOPIC)).toBe(true);
    const resourceTypes = audits.map((m) => (m.payload as { resourceType?: string }).resourceType);
    expect(resourceTypes).toContain("contract");
    expect(resourceTypes).toContain("citizen_grievance");
  });

  it("(B) CONSUME: audit-service registers a subscriber for audit.event.record", () => {
    const rq = new RecordingQueue();
    registerAuditConsumers(rq.asQueue());
    expect(rq.subscribedTopics.has(AUDIT_TOPIC)).toBe(true);
  });

  it("emitter and consumer agree on the exact topic string", () => {
    expect(AUDIT_CONSUME.auditEventRecord).toBe(AUDIT_TOPIC);
  });
});
