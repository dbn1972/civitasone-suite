/**
 * Integration chain #4 — project.milestone.completed → grant fund release.
 *
 * Wiring (same machinery as cross-domain-chains.test.ts): grant-service's REAL
 * `registerIntegrationConsumers(queue)` is mounted on ONE shared MemoryQueue.
 * We publish the PRODUCER event that project-service emits
 * (`project.milestone.completed`) and assert grant reacts by emitting the
 * downstream release command `grant.disbursement.initiate` for the installment
 * that was gated on that milestone — the producer→consumer hop is therefore real.
 *
 * The milestone→installment link is the one grant owns: a `pending` installment
 * carrying `milestoneId`. grant's DB + outbox are stubbed in-memory, so this runs
 * in CI with no Postgres. The installment that the consumer "reads" is provided
 * via `harness.seedSelect`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// --- grant-service data layer (downstream of this chain) --------------------
vi.mock("../../services/grant-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
});

vi.mock("../../services/grant-service/src/shared/outbox.js", async () => {
  const h = await import("./harness.js");
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

// `shared/infra.js` pulls in a real queue/cache at import time; stub it so the
// consumer module imports cleanly and `cache.invalidate` is a no-op in tests.
vi.mock("../../services/grant-service/src/shared/infra.js", async () => {
  return {
    queue: {},
    cache: {
      makeKey: (...parts: string[]) => parts.join(":"),
      invalidate: async () => undefined,
    },
  };
});

// Imported AFTER the mocks are declared (vi.mock is hoisted above imports).
const { registerIntegrationConsumers: registerGrantConsumers } = await import(
  "../../services/grant-service/src/modules/integration/consumer.js"
);

const TENANT = "11111111-aaaa-4000-8000-0000000000c4";
const ACTOR = "22222222-bbbb-4000-8000-0000000000c4";
const MILESTONE = "dddd0000-0000-4000-8000-0000000000c4";
const INSTALLMENT = "cccc0000-0000-4000-8000-0000000000c4";
const APPLICATION = "bbbb0000-0000-4000-8000-0000000000c4";

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

function pendingInstallment() {
  return {
    id: INSTALLMENT,
    tenantId: TENANT,
    applicationId: APPLICATION,
    milestoneId: MILESTONE,
    installmentNo: 1,
    amountMinor: 500000n,
    currency: "INR",
    status: "pending",
  };
}

let harness: ChainHarness;

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  registerGrantConsumers(harness.queue);
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("Chain #4: project.milestone.completed → grant fund release", () => {
  it("a completed project milestone releases the gated installment (emits grant.disbursement.initiate)", async () => {
    // The consumer reads the installments gated on this milestone.
    harness.seedSelect("installments", [pendingInstallment()]);

    // Subscribe BEFORE publishing so the downstream command is captured.
    const released = harness.nextEvent("grant.disbursement.initiate");

    await harness.queue.publish(
      "project.milestone.completed",
      envelope("aaaa1111-0001-4000-8000-0000000000c4", "project.milestone.completed", {
        milestoneId: MILESTONE,
        projectId: "eeee0000-0000-4000-8000-0000000000c4",
        name: "Foundation Complete",
      }),
    );

    const msg = await released;
    expect(msg.type).toBe("grant.disbursement.initiate");

    const p = msg.payload as {
      tenantId: string;
      installmentId: string;
      mode: string;
      id: string;
    };
    expect(p.tenantId).toBe(TENANT);
    expect(p.installmentId).toBe(INSTALLMENT);
    expect(p.mode).toBe("PFMS");
    expect(typeof p.id).toBe("string");
  });

  it("also emits an audit.event.record for the milestone-triggered release", async () => {
    harness.seedSelect("installments", [pendingInstallment()]);
    const auditEvent = harness.nextEvent("audit.event.record");

    await harness.queue.publish(
      "project.milestone.completed",
      envelope("aaaa1111-0002-4000-8000-0000000000c4", "project.milestone.completed", {
        milestoneId: MILESTONE,
        projectId: "eeee0000-0000-4000-8000-0000000000c4",
        name: "Roof Complete",
      }),
    );

    const msg = await auditEvent;
    const ap = msg.payload as { service: string; action: string; resourceType: string; resourceId: string };
    expect(ap.service).toBe("grant");
    expect(ap.action).toBe("milestone_fund_release");
    expect(ap.resourceType).toBe("grant_installment");
    expect(ap.resourceId).toBe(INSTALLMENT);
  });

  it("a milestone with no gated installment releases nothing", async () => {
    // No installment is linked to this milestone.
    harness.seedSelect("installments", []);

    const seen: string[] = [];
    harness.queue.subscribe("grant.disbursement.initiate", async () => {
      seen.push("released");
    });

    await harness.queue.publish(
      "project.milestone.completed",
      envelope("aaaa1111-0003-4000-8000-0000000000c4", "project.milestone.completed", {
        milestoneId: "ffff0000-0000-4000-8000-0000000000c4",
        projectId: "eeee0000-0000-4000-8000-0000000000c4",
        name: "Unlinked Milestone",
      }),
    );
    await new Promise((r) => setTimeout(r, 300));

    expect(seen).toHaveLength(0);
  });

  it("a redelivered milestone event releases the installment exactly once (idempotency across the hop)", async () => {
    harness.seedSelect("installments", [pendingInstallment()]);

    const seen: string[] = [];
    harness.queue.subscribe("grant.disbursement.initiate", async () => {
      seen.push("released");
    });

    const dup = envelope("aaaa1111-0004-4000-8000-0000000000c4", "project.milestone.completed", {
      milestoneId: MILESTONE,
      projectId: "eeee0000-0000-4000-8000-0000000000c4",
      name: "Foundation Complete",
    });

    await harness.queue.publish("project.milestone.completed", dup);
    await harness.queue.publish("project.milestone.completed", dup);
    await new Promise((r) => setTimeout(r, 300));

    // Same messageId delivered twice → markProcessed gates the second → one release.
    expect(seen).toHaveLength(1);
  });
});
