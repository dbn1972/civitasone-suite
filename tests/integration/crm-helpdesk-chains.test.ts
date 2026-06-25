/**
 * Chain #5 — crm.case.opened → helpdesk auto-opens a ticket (CONSUMER).
 *
 * Producer hop: a complaint-type CRM activity emits `crm.case.opened` (carrying
 * the activity id as the stable caseId). Consumer hop: helpdesk's EXISTING
 * inbound consumer (`tickets/consumer.ts`) subscribes to crm.case.opened and
 * idempotently opens a ticket via the SAME `insertLinkedIdempotent` path used by
 * the telephony hop (find-by-source then insert, partial unique backstop).
 *
 * Modeled on tests/integration/helpdesk-chains.test.ts (chain #11). We wire the
 * REAL helpdesk consumer onto the shared bus, publish the producer event, assert
 * a ticket insert with source=crm + source_ref=caseId, and assert idempotency
 * (redeliver same caseId → exactly one ticket; same messageId → swallowed).
 *
 * DB + outbox + cache infra are stubbed in-memory so it runs in CI with no infra.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// --- helpdesk-service data layer -------------------------------------------
vi.mock("../../services/helpdesk-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
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
const { registerTicketConsumers } = await import(
  "../../services/helpdesk-service/src/modules/tickets/consumer.js"
);

const TENANT = "aaaa1111-1111-4000-8000-000000000001";
const ACTOR = "bbbb2222-2222-4000-8000-000000000001";
const TICKET_ID = "cccc3333-3333-4000-8000-000000000001";

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
  // Wire the REAL helpdesk consumer onto the shared bus for these tests.
  registerTicketConsumers(harness.queue);
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

// ===========================================================================
// Chain #5 — crm.case.opened → helpdesk auto-opens a ticket (CONSUMER)
// ===========================================================================
describe("Cross-service chain #5: crm.case.opened → helpdesk auto-opens a ticket", () => {
  it("a CRM case opens a ticket linked to (source=crm, source_ref=caseId)", async () => {
    const caseId = "99990000-aaaa-4000-8000-000000000001";

    // Subscribe before publishing so the downstream ticket.created is captured.
    const created = harness.nextEvent("helpdesk.ticket.created");

    await harness.queue.publish(
      "crm.case.opened",
      envelope("55550000-000a-4000-8000-000000000001", "crm.case.opened", {
        caseId,
        subject: "Service complaint: portal outage",
        description: "Citizen reports certificate portal is down",
        contactId: "77770000-0001-4000-8000-000000000001",
      }),
    );

    const msg = await created;

    // Downstream assertion: a ticket row was written with the crm linkage.
    const ticketInserts = harness.inserts.filter((i) => i.table.includes("tickets"));
    expect(ticketInserts).toHaveLength(1);
    const row = ticketInserts[0]!.row as Record<string, unknown>;
    expect(row.source).toBe("crm");
    expect(row.sourceRef).toBe(caseId);
    expect(row.tenantId).toBe(TENANT);
    expect(row.status).toBe("open");
    expect(row.createdBy).toBe(ACTOR);
    expect(row.subject).toBe("Service complaint: portal outage");

    // ...and the ticket.created event carries the same linkage.
    const p = msg.payload as { source?: string; sourceRef?: string; ticketId?: string };
    expect(p.source).toBe("crm");
    expect(p.sourceRef).toBe(caseId);
  });

  it("falls back to a synthetic subject when the case carries none", async () => {
    const caseId = "99990000-bbbb-4000-8000-000000000001";
    await harness.queue.publish(
      "crm.case.opened",
      envelope("55550000-000b-4000-8000-000000000001", "crm.case.opened", { caseId }),
    );
    await new Promise((r) => setTimeout(r, 200));
    const ticketInserts = harness.inserts.filter((i) => i.table.includes("tickets"));
    expect(ticketInserts).toHaveLength(1);
    const row = ticketInserts[0]!.row as Record<string, unknown>;
    expect(row.subject).toBe(`CRM case — ${caseId}`);
    expect(row.source).toBe("crm");
  });

  it("a malformed event (no caseId) opens no ticket", async () => {
    await harness.queue.publish(
      "crm.case.opened",
      envelope("55550000-000c-4000-8000-000000000001", "crm.case.opened", {}),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(harness.inserts.filter((i) => i.table.includes("tickets"))).toHaveLength(0);
  });

  it("idempotency: redelivering the SAME caseId opens exactly one ticket", async () => {
    const caseId = "99990000-dddd-4000-8000-000000000001";
    const dup = (messageId: string) => envelope(messageId, "crm.case.opened", { caseId });

    // First delivery: nothing exists yet (default select → []), so insert runs.
    await harness.queue.publish("crm.case.opened", dup("66660000-0001-4000-8000-000000000001"));
    await new Promise((r) => setTimeout(r, 150));

    // The ticket now "exists" — model that for the source lookup on redelivery.
    harness.seedSelect("tickets", [
      { id: TICKET_ID, tenantId: TENANT, source: "crm", sourceRef: caseId },
    ]);

    // Redeliver with a DIFFERENT messageId so the inbox guard does NOT swallow it;
    // the ONLY thing preventing a second ticket is the source-ref idempotency.
    await harness.queue.publish("crm.case.opened", dup("66660000-0002-4000-8000-000000000001"));
    await new Promise((r) => setTimeout(r, 150));

    expect(harness.inserts.filter((i) => i.table.includes("tickets"))).toHaveLength(1);
  });

  it("idempotency: an inbox redelivery (same messageId) is also swallowed", async () => {
    const caseId = "99990000-eeee-4000-8000-000000000001";
    const dup = envelope("77770000-0001-4000-8000-000000000001", "crm.case.opened", { caseId });

    await harness.queue.publish("crm.case.opened", dup);
    await harness.queue.publish("crm.case.opened", dup);
    await new Promise((r) => setTimeout(r, 250));

    // Same messageId twice → markProcessed gates the second → one ticket.
    expect(harness.inserts.filter((i) => i.table.includes("tickets"))).toHaveLength(1);
  });
});
