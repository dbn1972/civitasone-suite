/**
 * P1-4 — Real cross-service chain #7: citizen grievance SLA breach → escalation.
 *
 * Tests the EXISTING citizen escalation path (sla-sweep scheduler publishes
 * citizen.grievance.sla_check; the grievance consumer auto-escalates a grievance
 * that has sat in "assigned" past the SLA window). Drives the real
 * grievanceSlaCheck consumer on the shared-queue harness: publish the sla_check
 * command, the real consumer reads the (seeded) grievance, inserts a level-1
 * escalation and emits grievance.escalated + notification.send + audit.event.record
 * under one correlationId. DB/outbox/cache stubbed in-memory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChainHarness, setCurrentHarness } from "./harness.js";

vi.mock("../../services/citizen-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
});
vi.mock("../../services/citizen-service/src/shared/outbox.js", async () => {
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
vi.mock("../../services/citizen-service/src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...p: string[]) => p.join(":") },
}));

const { registerGrievanceConsumers } = await import(
  "../../services/citizen-service/src/modules/grievance/consumer.js"
);

const TENANT = "77777777-aaaa-4000-8000-0000000000e0";
const ACTOR = "77777777-bbbb-4000-8000-0000000000e0";
const GRIEV = "77777777-cccc-4000-8000-0000000000e0";

function envelope(messageId: string, type: string, payload: Record<string, unknown>) {
  return {
    messageId, type, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload,
  };
}

// a grievance that has sat "assigned" for 30 days (SLA window = 7) → must escalate
function seedOverdueGrievance(h: ChainHarness, status = "assigned") {
  const updatedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  h.seedSelect("grievance", [{
    id: GRIEV, tenantId: TENANT, citizenId: "77777777-dddd-4000-8000-0000000000e0",
    status, updatedAt, departmentRef: "dept-revenue",
  }]);
}

let harness: ChainHarness;
beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  registerGrievanceConsumers(harness.queue);
  await harness.queue.start();
});
afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("Cross-service chain #7: citizen grievance SLA breach → escalation + notification + audit", () => {
  it("an overdue assigned grievance auto-escalates and fans out under one correlationId", async () => {
    seedOverdueGrievance(harness);
    const escalated = harness.nextEvent("citizen.grievance.escalated");
    const notify = harness.nextEvent("notification.send");
    const audit = harness.nextEvent("audit.event.record");

    await harness.queue.publish(
      "citizen.grievance.sla_check",
      envelope("e0000001-0001-4000-8000-0000000000e0", "citizen.grievance.sla_check", {
        grievanceId: GRIEV, tenantId: TENANT,
      }),
    );

    const [e, n, a] = await Promise.all([escalated, notify, audit]);
    // one correlationId across the whole fan-out
    expect(e.correlationId).toBe(n.correlationId);
    expect(n.correlationId).toBe(a.correlationId);
    expect((e.payload as { grievanceId: string }).grievanceId).toBe(GRIEV);
    expect((a.payload as { service: string; action: string }).service).toBe("citizen");
    expect((a.payload as { action: string }).action).toBe("auto_escalate");

    // a level-1 escalation row was written
    await new Promise((r) => setTimeout(r, 50));
    const esc = harness.inserts.filter(
      (i) => (i.row as { level?: unknown }).level === 1 && (i.row as { grievanceId?: unknown }).grievanceId === GRIEV,
    );
    expect(esc).toHaveLength(1);
    expect((esc[0].row as { status: string }).status).toBe("open");
  });

  it("does NOT escalate a grievance that is not overdue / not assigned", async () => {
    harness.seedSelect("grievance", [{
      id: GRIEV, tenantId: TENANT, citizenId: "77777777-dddd-4000-8000-0000000000e0",
      status: "registered", updatedAt: new Date(), departmentRef: "dept-revenue",
    }]);
    await harness.queue.publish(
      "citizen.grievance.sla_check",
      envelope("e0000002-0001-4000-8000-0000000000e0", "citizen.grievance.sla_check", {
        grievanceId: GRIEV, tenantId: TENANT,
      }),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(harness.inserts.filter((i) => (i.row as { level?: unknown }).level === 1)).toHaveLength(0);
  });

  it("a redelivered sla_check is processed once (idempotency across the hop)", async () => {
    seedOverdueGrievance(harness);
    const dup = envelope("e0000003-0001-4000-8000-0000000000e0", "citizen.grievance.sla_check", {
      grievanceId: GRIEV, tenantId: TENANT,
    });
    await harness.queue.publish("citizen.grievance.sla_check", dup);
    await harness.queue.publish("citizen.grievance.sla_check", dup);
    await new Promise((r) => setTimeout(r, 300));
    const esc = harness.inserts.filter(
      (i) => (i.row as { level?: unknown }).level === 1 && (i.row as { grievanceId?: unknown }).grievanceId === GRIEV,
    );
    expect(esc).toHaveLength(1);
  });
});
