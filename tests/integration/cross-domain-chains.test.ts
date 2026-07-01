/**
 * 10-T2 — Real cross-service E2E event chains for two PREVIOUSLY-UNTESTED hops.
 *
 * Same machinery as finance-chains.test.ts: a real downstream service's
 * `registerIntegrationConsumers(queue)` is wired onto ONE shared MemoryQueue,
 * we publish the PRODUCER service's event, and assert the downstream service
 * reacts — either by emitting its next event (captured by a real subscriber via
 * `harness.nextEvent`) or by writing the expected row (captured by the in-memory
 * db stub in `harness.inserts`). The producer→consumer hop is therefore real.
 *
 * Chains covered here:
 *   (A) procurement.grn.accepted  → finance drafts a vendor bill
 *                                    (emits finance.bill.create + audit.event.record)
 *   (B) tenant.tenant.created     → hrms provisions default leave types
 *                                    (writes rows into leave.hrms_leave_types)
 *
 * DB + outbox are stubbed in-memory for BOTH services (finance AND hrms), so
 * this runs in CI with no Postgres.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// --- finance-service data layer (downstream of chain A) ---------------------
vi.mock("../../services/finance-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
});

vi.mock("../../services/finance-service/src/shared/outbox.js", async () => {
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

// --- hrms-service data layer (downstream of chain B) ------------------------
vi.mock("../../services/hrms-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
});

vi.mock("../../services/hrms-service/src/shared/outbox.js", async () => {
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

// Imported AFTER the mocks are declared (vi.mock is hoisted above imports).
const { registerIntegrationConsumers: registerFinanceConsumers } = await import(
  "../../services/finance-service/src/modules/integrations/consumer.js"
);
const { registerIntegrationConsumers: registerHrmsConsumers } = await import(
  "../../services/hrms-service/src/modules/integration/consumer.js"
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
  // Wire BOTH real downstream consumers onto the shared bus. They subscribe to
  // disjoint topics, so co-registration does not cross-trigger.
  registerFinanceConsumers(harness.queue);
  registerHrmsConsumers(harness.queue);
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("Cross-service chain A: procurement.grn.accepted → finance.bill.create", () => {
  it("an accepted GRN makes finance draft a vendor bill carrying PO + GRN refs", async () => {
    // Subscribe BEFORE publishing so the downstream command is captured.
    const billCreated = harness.nextEvent("finance.bill.create");

    const grnId = "abcd1234-0001-4000-8000-000000000001";
    await harness.queue.publish(
      "procurement.grn.accepted",
      envelope("aaaaaaaa-000a-4000-8000-000000000001", "procurement.grn.accepted", {
        grnId,
        poRef: "PO-2025-00042",
        vendorId: "ddddffff-0001-4000-8000-000000000001",
        grossMinor: 750000,
      }),
    );

    const msg = await billCreated;
    expect(msg.type).toBe("finance.bill.create");

    const p = msg.payload as {
      tenantId: string;
      billNo: string;
      vendorId: string;
      grossMinor: number;
      netMinor: number;
      currency: string;
      poRef: string;
      grnRef: string;
      deductions: unknown[];
    };
    expect(p.tenantId).toBe(TENANT);
    expect(p.vendorId).toBe("ddddffff-0001-4000-8000-000000000001");
    expect(p.currency).toBe("INR");
    // No deductions on a GRN draft → net == gross.
    expect(String(p.grossMinor)).toBe("750000");
    expect(String(p.netMinor)).toBe("750000");
    expect(p.deductions).toEqual([]);
    // billNo derives from the first 8 chars of grnId, upper-cased.
    expect(p.billNo).toBe(`BILL/GRN/${grnId.slice(0, 8).toUpperCase()}`);
    // A bare PO ref gets the canonical "procurement_po:" prefix...
    expect(p.poRef).toBe("procurement_po:PO-2025-00042");
    // ...and the GRN ref is namespaced with the full grnId.
    expect(p.grnRef).toBe(`procurement_grn:${grnId}`);
  });

  it("also emits an audit.event.record for the bill draft", async () => {
    const auditEvent = harness.nextEvent("audit.event.record");

    await harness.queue.publish(
      "procurement.grn.accepted",
      envelope("aaaaaaaa-000b-4000-8000-000000000001", "procurement.grn.accepted", {
        grnId: "abcd1234-0002-4000-8000-000000000001",
        poRef: "procurement_po:PO-9",
        vendorId: "ddddffff-0002-4000-8000-000000000001",
        grossMinor: 100000,
      }),
    );

    const msg = await auditEvent;
    const ap = msg.payload as { service: string; action: string; resourceType: string };
    expect(ap.service).toBe("finance");
    expect(ap.action).toBe("grn_bill_draft");
    expect(ap.resourceType).toBe("bill");
  });

  it("a redelivered GRN event is processed once (idempotency across the hop)", async () => {
    const seen: string[] = [];
    harness.queue.subscribe("finance.bill.create", async () => {
      seen.push("billed");
    });

    const dup = envelope("aaaaaaaa-000c-4000-8000-000000000001", "procurement.grn.accepted", {
      grnId: "abcd1234-0003-4000-8000-000000000001",
      poRef: "PO-DUP",
      vendorId: "ddddffff-0003-4000-8000-000000000001",
      grossMinor: 50000,
    });

    await harness.queue.publish("procurement.grn.accepted", dup);
    await harness.queue.publish("procurement.grn.accepted", dup);
    await new Promise((r) => setTimeout(r, 300));

    // Same messageId delivered twice → markProcessed gates the second → one bill.
    expect(seen).toHaveLength(1);
  });
});

describe("Cross-service chain B: tenant.tenant.created → hrms default leave types", () => {
  it("a new tenant makes hrms provision the three default leave types", async () => {
    const newTenant = "33333333-cccc-4000-8000-000000000001";

    await harness.queue.publish(
      "tenant.tenant.created",
      envelope("bbbbbbbb-0001-4000-8000-000000000001", "tenant.tenant.created", {
        tenantId: newTenant,
      }),
    );

    // hrms emits NO downstream event for this hop; it only writes rows. Give the
    // async handler a tick, then assert on the captured inserts.
    await new Promise((r) => setTimeout(r, 200));

    const leaveRows = harness.inserts.filter(
      (i) => i.table.includes("leave_types") || typeof (i.row as { code?: unknown }).code === "string",
    );
    expect(leaveRows).toHaveLength(3);

    const byCode = new Map(
      leaveRows.map((i) => [(i.row as { code: string }).code, i.row as Record<string, unknown>]),
    );
    expect([...byCode.keys()].sort()).toEqual(["CL", "EL", "HPL"]);

    // Every provisioned row is scoped to the new tenant and stamped by the actor.
    for (const row of leaveRows) {
      expect(row.row.tenantId).toBe(newTenant);
      expect(row.row.createdBy).toBe(ACTOR);
      expect(row.row.updatedBy).toBe(ACTOR);
      expect(row.row.isEncashable).toBe(false);
    }

    // Earned Leave: 30 days, carries forward. Casual Leave: 15, no carry-forward.
    expect(byCode.get("EL")).toMatchObject({ name: "Earned Leave", maxDays: 30, carryForward: true });
    expect(byCode.get("CL")).toMatchObject({ name: "Casual Leave", maxDays: 15, carryForward: false });
    expect(byCode.get("HPL")).toMatchObject({ name: "Half Pay Leave", maxDays: 20, carryForward: false });
  });

  it("ignores a tenant.created event missing tenantId (no rows provisioned)", async () => {
    await harness.queue.publish(
      "tenant.tenant.created",
      envelope("bbbbbbbb-0002-4000-8000-000000000001", "tenant.tenant.created", {}),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(harness.inserts).toHaveLength(0);
  });
});
