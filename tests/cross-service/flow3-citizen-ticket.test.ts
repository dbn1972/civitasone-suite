/**
 * PHASE-3 FLOW 3 — Citizen request → Ticket.  ***ORPHANED / BROKEN***
 *
 * EXPECTED seam: a citizen service-request/grievance mutation → helpdesk-service
 * auto-creates a ticket.
 *
 * FINDINGS:
 *  1. citizen-service emits NO "citizen.request.created" (its request/grievance
 *     mutations emit citizen.grievance.* / citizen.application.* and, for
 *     register, only "audit.event.record"). No event a helpdesk consumer reads.
 *  2. helpdesk-service auto-opens tickets ONLY from CONSUMES = {
 *     "telephony.call.missed", "crm.case.opened", "ml.prediction.breach_risk_high" }.
 *     It subscribes to NO citizen.* topic.
 *  3. notification-service subscribes to a PHANTOM "citizen.request.created"
 *     (CONSUMED_EVENTS.citizenRequestCreated) that NO service ever emits — a
 *     silent dead subscription.
 *
 * VERDICT: ORPHANED — no citizen→helpdesk ticket seam exists.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ChainHarness, setCurrentHarness } from "../integration/harness.js";
import { RecordingQueue, envelope, collect, TENANT } from "./_helpers.js";
import { COMMANDS as CIT_COMMANDS, EVENTS as CIT_EVENTS } from "../../services/citizen-service/src/topics.js";
import { CONSUMES as HD_CONSUMES } from "../../services/helpdesk-service/src/topics.js";
import { CONSUMED_EVENTS as NOTIF_CONSUMED } from "../../services/notification-service/src/topics.js";

// ── citizen-service (source mutation) ───────────────────────────────────────
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

// ── helpdesk-service (would-be consumer) ────────────────────────────────────
vi.mock("../../services/helpdesk-service/src/shared/db.js", () => ({ db: {}, sqlClient: {} }));
vi.mock("../../services/helpdesk-service/src/shared/outbox.js", () => ({
  enqueue: async () => {},
  markProcessed: async () => true,
}));
vi.mock("../../services/helpdesk-service/src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, invalidateResource: async () => {}, makeKey: (...p: string[]) => p.join(":") },
}));

const { registerGrievanceConsumers } = await import(
  "../../services/citizen-service/src/modules/grievance/consumer.js"
);
const { registerTicketConsumers } = await import(
  "../../services/helpdesk-service/src/modules/tickets/consumer.js"
);

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

describe("FLOW 3 — Citizen request → Ticket (ORPHANED)", () => {
  it("(A) EMIT: a citizen request/grievance mutation emits NO helpdesk-consumable event", async () => {
    const audit = collect(harness, "audit.event.record");
    const phantom = collect(harness, "citizen.request.created");

    await harness.queue.publish(
      CIT_COMMANDS.grievanceRegister,
      envelope(randomUUID(), CIT_COMMANDS.grievanceRegister, {
        id: randomUUID(),
        tenantId: TENANT,
        citizenId: "cc000000-0000-4000-8000-000000000001",
        category: "water",
        subject: "No supply",
        description: "3 days without water",
      }),
    );
    await harness.queue.drain();

    // The mutation runs (emits an audit trail) …
    expect(audit.length).toBeGreaterThanOrEqual(1);
    // … but emits nothing on the topic anyone expects for a ticket handoff.
    expect(phantom.length).toBe(0);
  });

  it("FINDING: no service emits citizen.request.created (notification's subscription is dead)", () => {
    expect(NOTIF_CONSUMED.citizenRequestCreated).toBe("citizen.request.created");
    const citizenTopics = [...Object.values(CIT_COMMANDS), ...Object.values(CIT_EVENTS)] as string[];
    expect(citizenTopics).not.toContain("citizen.request.created");
  });

  it("(B) CONSUME: helpdesk subscribes to NO citizen topic (only telephony/crm/ml)", () => {
    const rq = new RecordingQueue();
    registerTicketConsumers(rq.asQueue());
    const subs = [...rq.subscribedTopics];
    expect(subs).toContain(HD_CONSUMES.telephonyCallMissed);
    expect(subs).toContain(HD_CONSUMES.crmCaseOpened);
    expect(subs.some((t) => t.startsWith("citizen."))).toBe(false);
  });
});
