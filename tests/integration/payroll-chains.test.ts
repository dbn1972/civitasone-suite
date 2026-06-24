/**
 * 10-T2 — Real cross-service E2E event chains (PAYROLL is the downstream svc).
 *
 * Mirrors finance-chains.test.ts, but wires the REAL payroll-service
 * `registerIntegrationConsumers(queue)` onto a shared MemoryQueue and publishes
 * the PRODUCER service's events (hrms.* / finance.payment.made). The real
 * payroll handler then reacts by writing a row (captured by the in-memory db
 * stub in `harness.inserts`) and/or emitting its next event (captured by a real
 * subscriber via `harness.nextEvent(topic)`).
 *
 * The producer→consumer hop is real: publish → MemoryQueue delivers → real
 * payroll handler runs → (for gratuity) its outbox enqueue re-publishes
 * `audit.event.record` onto the same queue → a real subscriber consumes it.
 *
 * DB is stubbed entirely in-memory (see harness.ts). We mock payroll-service's
 * `shared/db.js` (transactional fake) and `shared/outbox.js` (relay-on-enqueue
 * + in-memory inbox).
 *
 * Two payroll-specific runtime extensions are layered onto the shared harness's
 * in-memory `tx` *from this test only* (we do NOT edit harness.ts):
 *   - `tx.execute(sql)`  — the employee.separated handler runs a raw
 *     `SELECT rate_bps ...` to resolve the DA rate; the shared tx has no
 *     `execute`, so we attach one that returns `harness.executeRows` (seeded
 *     per-test). This is the documented `harness.executeRows = [...]` seam.
 *   - `tx.update(...)`   — wrapped to capture update calls (markSlipsPaidForRun
 *     issues an UPDATE, which the shared stub otherwise swallows), so we can
 *     assert the real effect of finance.payment.made.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// Replace payroll-service's DB layer with the in-memory transactional fake.
vi.mock("../../services/payroll-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
});

// Replace payroll-service's transactional outbox/inbox. `enqueue` re-publishes
// onto the shared queue (the cross-service hop); `markProcessed` is in-memory.
vi.mock("../../services/payroll-service/src/shared/outbox.js", async () => {
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
  "../../services/payroll-service/src/modules/integration/consumer.js"
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

/** Poll until `cond()` is true or the timeout elapses (handlers run async). */
async function waitFor(cond: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

const tick = (ms = 200) => new Promise((r) => setTimeout(r, ms));

// Runtime view of the shared harness internals we extend for the payroll paths.
type CapturedUpdate = { table: unknown; patch: Record<string, unknown> };
interface HarnessInternals {
  tx: {
    execute?: (query: unknown) => Promise<unknown[]>;
    update: (table: unknown) => { set: (patch: Record<string, unknown>) => { where: (cond: unknown) => Promise<void> } };
  };
  executeRows?: Array<Record<string, unknown>>;
}

let harness: ChainHarness;
let capturedUpdates: CapturedUpdate[];

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  capturedUpdates = [];

  const internals = harness as unknown as HarnessInternals;
  // Seam for the employee.separated DA-rate SELECT (default: empty → DA 0).
  internals.executeRows = [];
  internals.tx.execute = async () => internals.executeRows ?? [];
  // Capture UPDATEs (markSlipsPaidForRun) the shared stub otherwise swallows.
  internals.tx.update = (table: unknown) => ({
    set: (patch: Record<string, unknown>) => ({
      where: async () => {
        capturedUpdates.push({ table, patch });
      },
    }),
  });

  // Wire the REAL downstream payroll consumers onto the shared bus.
  registerIntegrationConsumers(harness.queue);
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("Cross-service chain 1: hrms.leave.approved → payroll LOP ledger write", () => {
  it("an approved leave makes payroll upsert an LOP ledger row for the employee/month", async () => {
    // upsertLopDays first SELECTs existing rows; the in-memory stub returns [],
    // so the consumer takes the INSERT-on-new branch (lop-repo.ts).
    await harness.queue.publish(
      "hrms.leave.approved",
      envelope("aaaaaaaa-1001-4000-8000-000000000001", "hrms.leave.approved", {
        employeeId: "33333333-0001-4000-8000-000000000001",
        daysApplied: 3,
        fromDate: "2025-04-10",
      }),
    );

    await waitFor(() => harness.inserts.some((i) => i.row.source === "leave"));

    const lop = harness.inserts.find((i) => i.row.source === "leave");
    expect(lop, "expected a payroll_lop_ledger row from the leave feed").toBeDefined();
    expect(lop!.table).toBe("payroll_lop_ledger");
    expect(lop!.row.tenantId).toBe(TENANT);
    expect(lop!.row.employeeId).toBe("33333333-0001-4000-8000-000000000001");
    expect(lop!.row.month).toBe("2025-04"); // fromDate.slice(0,7)
    expect(lop!.row.lopDays).toBe(3); // daysApplied
  });
});

describe("Cross-service chain 2: hrms.attendance.marked → payroll LOP ledger write", () => {
  it("status=absent writes a 1-day LOP ledger row", async () => {
    await harness.queue.publish(
      "hrms.attendance.marked",
      envelope("aaaaaaaa-2001-4000-8000-000000000001", "hrms.attendance.marked", {
        employeeId: "33333333-0002-4000-8000-000000000001",
        attendanceDate: "2025-05-12",
        status: "absent",
      }),
    );

    await waitFor(() => harness.inserts.some((i) => i.row.source === "attendance"));

    const lop = harness.inserts.find((i) => i.row.source === "attendance");
    expect(lop, "expected a payroll_lop_ledger row from the attendance feed").toBeDefined();
    expect(lop!.row.month).toBe("2025-05");
    expect(lop!.row.lopDays).toBe(1);
    expect(lop!.row.employeeId).toBe("33333333-0002-4000-8000-000000000001");
  });

  it("status=present is ignored (early return — no write)", async () => {
    await harness.queue.publish(
      "hrms.attendance.marked",
      envelope("aaaaaaaa-2002-4000-8000-000000000001", "hrms.attendance.marked", {
        employeeId: "33333333-0003-4000-8000-000000000001",
        attendanceDate: "2025-05-13",
        status: "present",
      }),
    );

    // Give the (no-op) handler ample time to run; assert nothing was written.
    await tick();
    expect(harness.inserts).toHaveLength(0);
  });
});

describe("Cross-service chain 3: hrms.employee.separated → gratuity row + audit event", () => {
  it("computes gratuity, writes the row, and emits audit.event.record (gratuity_compute)", async () => {
    // Seed the DA-rate SELECT so DA (and therefore gratuity) is non-zero.
    (harness as unknown as HarnessInternals).executeRows = [{ rate_bps: 500 }]; // 5% DA

    // Subscribe BEFORE publishing so the emitted audit event is captured.
    const auditEvent = harness.nextEvent("audit.event.record");

    await harness.queue.publish(
      "hrms.employee.separated",
      envelope("aaaaaaaa-3001-4000-8000-000000000001", "hrms.employee.separated", {
        employeeId: "33333333-0004-4000-8000-000000000001",
        effectiveDate: "2025-01-01",
        dateOfJoining: "2015-01-01", // ~10 yrs → >5 → gratuity > 0
        basicMinor: "5000000", // 50,000 INR
      }),
    );

    const msg = await auditEvent;
    const ap = msg.payload as { service: string; action: string; resourceType: string; resourceId: string; outcome: string };
    expect(ap.service).toBe("payroll");
    expect(ap.action).toBe("gratuity_compute");
    expect(ap.resourceType).toBe("gratuity");
    expect(ap.resourceId).toBe("33333333-0004-4000-8000-000000000001");
    expect(ap.outcome).toBe("success");

    // The gratuity row the consumer wrote (statutoryRepo.insertGratuity).
    const grat = harness.inserts.find((i) => i.row.status === "computed" && i.row.gratuityMinor != null);
    expect(grat, "expected a payroll_gratuity row to be written").toBeDefined();
    expect(grat!.table).toBe("payroll_gratuity");
    expect(grat!.row.employeeId).toBe("33333333-0004-4000-8000-000000000001");
    expect(grat!.row.currency).toBe("INR");
    expect(grat!.row.separationRef).toBe("separation:2025-01-01");
    expect(typeof grat!.row.gratuityMinor).toBe("bigint");
    expect(grat!.row.gratuityMinor as bigint).toBeGreaterThan(0n);
  });
});

describe("Cross-service chain 4: finance.payment.made → markSlipsPaidForRun", () => {
  it("outcome=success with a payrollRunId marks the run's slips paid", async () => {
    await harness.queue.publish(
      "finance.payment.made",
      envelope("aaaaaaaa-4001-4000-8000-000000000001", "finance.payment.made", {
        payrollRunId: "99999999-0001-4000-8000-000000000001",
        outcome: "success",
      }),
    );

    await waitFor(() => capturedUpdates.length > 0);

    expect(capturedUpdates, "expected an UPDATE marking slips paid").toHaveLength(1);
    expect(capturedUpdates[0]!.patch.status).toBe("paid");
    expect(capturedUpdates[0]!.patch.updatedBy).toBe(ACTOR);
  });

  it("outcome!=success is ignored (early return — no update)", async () => {
    await harness.queue.publish(
      "finance.payment.made",
      envelope("aaaaaaaa-4002-4000-8000-000000000001", "finance.payment.made", {
        payrollRunId: "99999999-0002-4000-8000-000000000001",
        outcome: "failed",
      }),
    );

    await tick();
    expect(capturedUpdates).toHaveLength(0);
  });
});

describe("Idempotency across the hop", () => {
  // A redelivered producer event must not write twice. Both the bus (messageId
  // dedupe) and the consumer's inbox (markProcessed) enforce this; either way
  // the LOP ledger gets exactly one write.
  it("a redelivered hrms.leave.approved is processed once", async () => {
    const dup = envelope("aaaaaaaa-5001-4000-8000-000000000001", "hrms.leave.approved", {
      employeeId: "33333333-0005-4000-8000-000000000001",
      daysApplied: 2,
      fromDate: "2025-06-01",
    });

    await harness.queue.publish("hrms.leave.approved", dup);
    await harness.queue.publish("hrms.leave.approved", dup);
    await tick(300);

    const leaveWrites = harness.inserts.filter((i) => i.row.source === "leave");
    expect(leaveWrites).toHaveLength(1);
  });
});
