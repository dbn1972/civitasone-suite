/**
 * 10-T3 — Real cross-service E2E event chains for helpdesk-service (just merged).
 *
 * Two now-wired hops, both previously untested:
 *
 *   Chain #6  — helpdesk SLA-breach sweeper (PRODUCER):
 *               `tickets/sweeper.ts` `sweepSlaBreaches` scans still-open tickets
 *               (`repo.findOpenForSla` → `db.select`), decides at-risk/breached
 *               in-process via `computeSla`, CAS-claims a one-shot marker column
 *               (`markSlaNotified` → `update(...).returning(...)`), and under one
 *               correlationId enqueues helpdesk.ticket.escalated + notification.send
 *               + audit.event.record. Modeled on workflow-sla-chains.test.ts:
 *               seed the breached ticket via `harness.seedSelect`, drive the
 *               sweeper directly, assert all THREE topics fire correlated, and
 *               assert the one-shot guard (already-notified → no re-emit).
 *
 *   Chain #11 — telephony.call.missed → helpdesk auto-opens a ticket (CONSUMER):
 *               `tickets/consumer.ts` subscribes to telephony.call.missed and
 *               idempotently opens a ticket (find-by-source then insert, partial
 *               unique backstop). Modeled on cross-domain-chains.test.ts: wire the
 *               real consumer onto the shared bus, publish the producer event,
 *               assert a ticket insert with source=telephony + source_ref=callId,
 *               and assert idempotency (redeliver same callId → one ticket).
 *
 * DB + outbox + cache infra are stubbed in-memory so it runs in CI with no infra.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CommandEnvelope } from "../../packages/queue/dist/index.js";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// --- helpdesk-service data layer -------------------------------------------
vi.mock("../../services/helpdesk-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {}, scopedRead: (fn: any) => h.mockDb.transaction(fn) };
});

vi.mock("../../services/helpdesk-service/src/shared/outbox.js", async () => {
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

// The consumer pulls in shared/infra.js for the read-through cache (makeKey/put/
// invalidateResource) and the createQueue() singleton; stub both so nothing
// reaches a real Redis/queue driver. The sweeper does not touch infra.
vi.mock("../../services/helpdesk-service/src/shared/infra.js", async () => {
  return {
    cache: {
      makeKey: (...p: string[]) => p.join(":"),
      put: async () => {},
      invalidateResource: async () => {},
    },
    queue: { publish: async () => {}, subscribe: () => {} },
  };
});

// Imported AFTER the mocks are declared (vi.mock is hoisted above imports).
const { sweepSlaBreaches, SYSTEM_ACTOR_ID } = await import(
  "../../services/helpdesk-service/src/modules/tickets/sweeper.js"
);
const { registerTicketConsumers } = await import(
  "../../services/helpdesk-service/src/modules/tickets/consumer.js"
);

const TENANT = "aaaa1111-1111-4000-8000-000000000001";
const ACTOR = "bbbb2222-2222-4000-8000-000000000001";
const TICKET_ID = "cccc3333-3333-4000-8000-000000000001";
const ASSIGNEE_ID = "dddd4444-4444-4000-8000-000000000001";
const CREATOR_ID = "eeee5555-5555-4000-8000-000000000001";

const DAY = 24 * 60 * 60 * 1000;

/**
 * A still-open Medium ticket created 6 days ago → SLA window is 5 days → the due
 * date is 1 day in the past → computeSla() classifies it `breached`. Neither SLA
 * marker stamped, so the sweeper should fire the breach stage exactly once.
 */
function breachedTicket(now: Date, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: TICKET_ID,
    tenantId: TENANT,
    subject: "Printer down in registry",
    description: "Cannot print certificates",
    priority: "medium",
    status: "open",
    assigneeId: ASSIGNEE_ID,
    createdBy: CREATOR_ID,
    updatedBy: CREATOR_ID,
    createdAt: new Date(now.getTime() - 6 * DAY).toISOString(),
    slaAtRiskNotifiedAt: null,
    slaBreachedNotifiedAt: null,
    version: 1,
    ...over,
  };
}

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
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

// ===========================================================================
// Chain #6 — helpdesk SLA breach → notification + escalation + audit (PRODUCER)
// ===========================================================================
describe("Cross-service chain #6: helpdesk SLA sweeper → notification + escalation + audit", () => {
  it("a breached ticket fans out all three topics under one correlationId", async () => {
    const now = new Date("2026-06-25T10:00:00.000Z");

    // tickets select → one breached, never-notified ticket; the CAS marker
    // update claims the row (returns one id).
    harness.seedSelect("tickets", [breachedTicket(now)]);
    harness.seedUpdateReturning([{ id: TICKET_ID }]);

    // Capture every emit, keyed by topic, to prove all three fired correlated.
    const got: Record<string, CommandEnvelope> = {};
    for (const topic of ["helpdesk.ticket.escalated", "notification.send", "audit.event.record"]) {
      harness.queue.subscribe(topic, async (msg) => {
        got[topic] = msg;
      });
    }

    const notified = await sweepSlaBreaches(now);
    await new Promise((r) => setTimeout(r, 200));

    expect(notified).toBe(1);

    // Downstream assertion: all three topics fired.
    expect(got["helpdesk.ticket.escalated"]).toBeTruthy();
    expect(got["notification.send"]).toBeTruthy();
    expect(got["audit.event.record"]).toBeTruthy();

    // ...and they share ONE correlationId (per-ticket breach correlation).
    const corr = got["helpdesk.ticket.escalated"]!.correlationId;
    expect(got["notification.send"]!.correlationId).toBe(corr);
    expect(got["audit.event.record"]!.correlationId).toBe(corr);

    // Escalation event carries the ticket + breach stage + recipient (assignee).
    const esc = got["helpdesk.ticket.escalated"]!.payload as {
      ticketId: string;
      subject: string;
      priority: string;
      slaStatus: string;
      recipient: string;
    };
    expect(esc.ticketId).toBe(TICKET_ID);
    expect(esc.slaStatus).toBe("breached");
    expect(esc.recipient).toBe(ASSIGNEE_ID);

    // Notification targets the same recipient.
    const note = got["notification.send"]!.payload as { recipient: string; eventType: string };
    expect(note.recipient).toBe(ASSIGNEE_ID);
    expect(note.eventType).toBe("helpdesk.ticket.escalated");

    // Audit is the canonical helpdesk sla_breach row.
    const aud = got["audit.event.record"]!.payload as {
      service: string;
      action: string;
      resourceType: string;
      resourceId: string;
    };
    expect(aud.service).toBe("helpdesk");
    expect(aud.action).toBe("sla_breach");
    expect(aud.resourceType).toBe("ticket");
    expect(aud.resourceId).toBe(TICKET_ID);

    // All three attributed to the system actor (not the ticket creator).
    expect(got["helpdesk.ticket.escalated"]!.actorId).toBe(SYSTEM_ACTOR_ID);
    expect(got["notification.send"]!.actorId).toBe(SYSTEM_ACTOR_ID);
    expect(got["audit.event.record"]!.actorId).toBe(SYSTEM_ACTOR_ID);
  });

  it("falls back to the creator as recipient when the ticket is unassigned", async () => {
    const now = new Date("2026-06-25T10:00:00.000Z");
    harness.seedSelect("tickets", [breachedTicket(now, { assigneeId: null })]);
    harness.seedUpdateReturning([{ id: TICKET_ID }]);

    const esc = harness.nextEvent("helpdesk.ticket.escalated");
    await sweepSlaBreaches(now);
    const msg = await esc;
    expect((msg.payload as { recipient: string }).recipient).toBe(CREATOR_ID);
  });

  it("one-shot guard: an already-breach-notified ticket re-emits nothing", async () => {
    const now = new Date("2026-06-25T10:00:00.000Z");
    // Marker already stamped → sweeper's `alreadySent` short-circuits BEFORE the
    // tx/CAS, so it never even attempts to claim or emit.
    harness.seedSelect("tickets", [
      breachedTicket(now, { slaBreachedNotifiedAt: new Date(now.getTime() - DAY).toISOString() }),
    ]);

    let emits = 0;
    for (const topic of ["helpdesk.ticket.escalated", "notification.send", "audit.event.record"]) {
      harness.queue.subscribe(topic, async () => {
        emits++;
      });
    }

    const notified = await sweepSlaBreaches(now);
    await new Promise((r) => setTimeout(r, 200));

    expect(notified).toBe(0);
    expect(emits).toBe(0);
  });

  it("one-shot guard: a lost CAS race (zero rows claimed) emits nothing", async () => {
    const now = new Date("2026-06-25T10:00:00.000Z");
    // Candidate looks un-notified, but a concurrent sweep already stamped it →
    // the CAS `update(...).returning()` claims zero rows → no fan-out.
    harness.seedSelect("tickets", [breachedTicket(now)]);
    harness.seedUpdateReturning([]);

    let emits = 0;
    for (const topic of ["helpdesk.ticket.escalated", "notification.send", "audit.event.record"]) {
      harness.queue.subscribe(topic, async () => {
        emits++;
      });
    }

    const notified = await sweepSlaBreaches(now);
    await new Promise((r) => setTimeout(r, 200));

    expect(notified).toBe(0);
    expect(emits).toBe(0);
  });

  it("a within-SLA ticket is skipped (no fan-out)", async () => {
    const now = new Date("2026-06-25T10:00:00.000Z");
    // Created 1h ago, Medium (5-day window) → well within SLA.
    harness.seedSelect("tickets", [
      breachedTicket(now, { createdAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString() }),
    ]);
    harness.seedUpdateReturning([{ id: TICKET_ID }]);

    let emits = 0;
    for (const topic of ["helpdesk.ticket.escalated", "notification.send", "audit.event.record"]) {
      harness.queue.subscribe(topic, async () => {
        emits++;
      });
    }

    const notified = await sweepSlaBreaches(now);
    await new Promise((r) => setTimeout(r, 200));

    expect(notified).toBe(0);
    expect(emits).toBe(0);
  });
});

// ===========================================================================
// Chain #11 — telephony.call.missed → helpdesk auto-opens a ticket (CONSUMER)
// ===========================================================================
describe("Cross-service chain #11: telephony.call.missed → helpdesk auto-opens a ticket", () => {
  beforeEach(() => {
    // Wire the REAL helpdesk consumer onto the shared bus for these tests.
    registerTicketConsumers(harness.queue);
  });

  it("a missed call opens a ticket linked to (source=telephony, source_ref=callId)", async () => {
    const callId = "call-9a8b7c6d";

    // Subscribe before publishing so the downstream ticket.created is captured.
    const created = harness.nextEvent("helpdesk.ticket.created");

    await harness.queue.publish(
      "telephony.call.missed",
      envelope("11111111-000a-4000-8000-000000000001", "telephony.call.missed", {
        callId,
        status: "missed",
      }),
    );

    const msg = await created;

    // Downstream assertion: a ticket row was written with the telephony linkage.
    const ticketInserts = harness.inserts.filter((i) => i.table.includes("tickets"));
    expect(ticketInserts).toHaveLength(1);
    const row = ticketInserts[0]!.row as Record<string, unknown>;
    expect(row.source).toBe("telephony");
    expect(row.sourceRef).toBe(callId);
    expect(row.tenantId).toBe(TENANT);
    expect(row.status).toBe("open");
    expect(row.createdBy).toBe(ACTOR);

    // ...and the ticket.created event carries the same linkage.
    const p = msg.payload as { source?: string; sourceRef?: string; ticketId?: string };
    expect(p.source).toBe("telephony");
    expect(p.sourceRef).toBe(callId);
  });

  it("a malformed event (no callId) opens no ticket", async () => {
    await harness.queue.publish(
      "telephony.call.missed",
      envelope("11111111-000b-4000-8000-000000000001", "telephony.call.missed", {}),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(harness.inserts.filter((i) => i.table.includes("tickets"))).toHaveLength(0);
  });

  it("idempotency: redelivering the SAME callId opens exactly one ticket", async () => {
    const callId = "call-dup-1234";

    // First delivery: nothing exists yet (default select → []), so insert runs.
    // After it, seed the source lookup so the SECOND, distinct-messageId delivery
    // takes the find-then-insert no-op path (read-before-write idempotency).
    const dup = (messageId: string) =>
      envelope(messageId, "telephony.call.missed", { callId });

    await harness.queue.publish("telephony.call.missed", dup("22222222-0001-4000-8000-000000000001"));
    await new Promise((r) => setTimeout(r, 150));

    // The ticket now "exists" — model that for the source lookup on redelivery.
    harness.seedSelect("tickets", [
      { id: TICKET_ID, tenantId: TENANT, source: "telephony", sourceRef: callId },
    ]);

    // Redeliver with a DIFFERENT messageId so the inbox guard does NOT swallow it;
    // the ONLY thing preventing a second ticket is the source-ref idempotency.
    await harness.queue.publish("telephony.call.missed", dup("22222222-0002-4000-8000-000000000001"));
    await new Promise((r) => setTimeout(r, 150));

    expect(harness.inserts.filter((i) => i.table.includes("tickets"))).toHaveLength(1);
  });

  it("idempotency: an inbox redelivery (same messageId) is also swallowed", async () => {
    const callId = "call-inbox-5678";
    const dup = envelope("33333333-0001-4000-8000-000000000001", "telephony.call.missed", { callId });

    await harness.queue.publish("telephony.call.missed", dup);
    await harness.queue.publish("telephony.call.missed", dup);
    await new Promise((r) => setTimeout(r, 250));

    // Same messageId twice → markProcessed gates the second → one ticket.
    expect(harness.inserts.filter((i) => i.table.includes("tickets"))).toHaveLength(1);
  });
});
