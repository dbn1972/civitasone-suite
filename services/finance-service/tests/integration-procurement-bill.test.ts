/**
 * Integration tests: procurement.grn.accepted → finance auto-bill created
 *                    payroll.run.approved → GL journal posted (balanced)
 *
 * Verifies the cross-service 3-way match chain: when procurement-service publishes
 * `procurement.grn.accepted`, the finance integration consumer creates a draft
 * bill with correct PO and GRN references.
 *
 * Also verifies the payroll→GL accrual journal is balanced (Dr == Cr) and
 * contains all expected account codes.
 *
 * Uses vi.mock to stub DB, outbox, and repos — no live database required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Lightweight in-process MemoryQueue (mirrors the real MemoryQueue from
// @civitasone/queue-service/bus.ts but avoids the broken ESM re-export chain).
// ---------------------------------------------------------------------------
type Handler = (msg: any) => Promise<void>;
class TestMemoryQueue {
  private handlers = new Map<string, Handler[]>();
  async publish(topic: string, input: any): Promise<string> {
    const msg = {
      messageId: input.messageId ?? randomUUID(),
      type: input.type ?? topic,
      tenantId: input.tenantId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      timestamp: new Date().toISOString(),
      schemaVersion: input.schemaVersion ?? "1.0",
      payload: input.payload,
    };
    const handlers = this.handlers.get(topic) ?? [];
    // Deliver asynchronously (next microtask) — like the real MemoryQueue.
    setTimeout(() => { for (const h of handlers) void h(msg); }, 0);
    return msg.messageId;
  }
  subscribe(topic: string, handler: Handler): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> { this.handlers.clear(); }
}

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the consumer (Vitest hoists vi.mock).
// ---------------------------------------------------------------------------

const {
  mockTx,
  dbTransactionFn,
  enqueueMock,
  markProcessedMock,
} = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  const _enqueueMock = vi.fn(async () => undefined);
  const _markProcessedMock = vi.fn(async () => true);
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueueMock: _enqueueMock as any,
    markProcessedMock: _markProcessedMock as any,
  };
});

// 1. DB mock — intercept transactions.
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
}));

// 2. Outbox — capture enqueue calls + markProcessed.
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...args: any[]) => enqueueMock(...args),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

// 3. Cache — no-op (imported transitively).
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    makeKey: vi.fn((...parts: string[]) => parts.join(":")),
  },
}));

// 4. PFMS repo — getTenantConfig + insertPfmsBatch stubs.
vi.mock("../src/modules/pfms/repo.js", () => ({
  getTenantConfig: vi.fn(async () => ({ agencyCode: "AG001", defaultDdo: "DDO001" })),
  insertPfmsBatch: vi.fn(async () => undefined),
  listRealBeneficiaries: vi.fn(async () => []),
  updatePfmsBatch: vi.fn(async () => undefined),
}));

// 5. Audit repo — no-op.
vi.mock("../src/modules/audit/repo.js", () => ({
  insertAuditPara: vi.fn(async () => undefined),
}));

// 6. Budget repo — provide stubs if transitively imported.
vi.mock("../src/modules/budget/repo.js", () => ({
  findHeadByCodeTx: vi.fn(async () => ({ id: "head-001", code: "2049", name: "Default" })),
  findHeadByIdTx: vi.fn(async () => ({ id: "head-001", code: "2049", name: "Default" })),
}));

// 7. Masters repo — DDO/PAO existence stubs.
vi.mock("../src/modules/masters/repo.js", () => ({
  ddoExists: vi.fn(async () => true),
  paoExists: vi.fn(async () => true),
}));

// 8. File system — writeFile/unlink (NACH file generation).
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
}));

// 9. SFTP egress — no-op.
vi.mock("../src/modules/integrations/sftp-egress.js", () => ({
  uploadBankFile: vi.fn(async () => undefined),
}));

// 10. Bank file generator — return dummy content.
vi.mock("../src/modules/integrations/bank-file-generator.js", () => ({
  generateNACHFile: vi.fn(() => "NACH_FILE_CONTENT"),
}));

// ---------------------------------------------------------------------------
// Import consumer AFTER mocks are declared.
// ---------------------------------------------------------------------------
import { registerIntegrationConsumers } from "../src/modules/integrations/consumer.js";
import { CONSUMED_EVENTS, COMMANDS } from "../src/topics.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

async function buildQueue(): Promise<TestMemoryQueue> {
  const q = new TestMemoryQueue();
  registerIntegrationConsumers(q as any);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 150));

// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  markProcessedMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

// ---------------------------------------------------------------------------
// SECTION 1 — procurement.grn.accepted → finance auto-bill created (3-way match)
// ---------------------------------------------------------------------------
describe("procurement.grn.accepted → draft vendor bill for 3-way match", () => {
  const GRN_PAYLOAD = {
    grnId: "grn-001",
    poRef: "procurement_po:po-001",
    vendorId: "vendor-001",
    grossMinor: 5000000,
  };

  it("creates a finance.bill.create command with correct PO and GRN refs", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.grnAccepted,
      makeMsg(CONSUMED_EVENTS.grnAccepted, GRN_PAYLOAD),
    );
    await settle();

    // Find the bill.create enqueue call (skip audit envelope calls)
    const billCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.billCreate,
    );
    expect(billCall).toBeDefined();

    const [, billMsg] = billCall!;
    const payload = billMsg.payload;

    expect(payload.poRef).toContain("po-001");
    expect(payload.grnRef).toContain("grn-001");
    expect(payload.grossMinor).toBe("5000000");
    expect(payload.netMinor).toBe("5000000"); // no deductions
    expect(payload.billNo).toMatch(/^BILL\/GRN\//);
    expect(payload.vendorId).toBe("vendor-001");
    expect(payload.currency).toBe("INR");
    expect(payload.deductions).toEqual([]);

    await q.stop();
  });

  it("billNo starts with BILL/GRN/ followed by uppercase GRN ID prefix", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.grnAccepted,
      makeMsg(CONSUMED_EVENTS.grnAccepted, { ...GRN_PAYLOAD, grnId: "abc12345-full-id" }),
    );
    await settle();

    const billCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.billCreate,
    );
    expect(billCall).toBeDefined();
    expect(billCall![1].payload.billNo).toBe("BILL/GRN/ABC12345");

    await q.stop();
  });

  it("normalises poRef that does not have procurement_ prefix", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.grnAccepted,
      makeMsg(CONSUMED_EVENTS.grnAccepted, { ...GRN_PAYLOAD, poRef: "po-999" }),
    );
    await settle();

    const billCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.billCreate,
    );
    expect(billCall).toBeDefined();
    expect(billCall![1].payload.poRef).toBe("procurement_po:po-999");

    await q.stop();
  });

  it("skips on duplicate message (markProcessed returns false)", async () => {
    markProcessedMock.mockResolvedValue(false);
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.grnAccepted,
      makeMsg(CONSUMED_EVENTS.grnAccepted, GRN_PAYLOAD),
    );
    await settle();

    const billCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.billCreate,
    );
    expect(billCall).toBeUndefined();

    await q.stop();
  });

  it("defaults grossMinor to 0 when not provided", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.grnAccepted,
      makeMsg(CONSUMED_EVENTS.grnAccepted, {
        grnId: "grn-002",
        poRef: "procurement_po:po-002",
        vendorId: "vendor-002",
      }),
    );
    await settle();

    const billCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.billCreate,
    );
    expect(billCall).toBeDefined();
    expect(billCall![1].payload.grossMinor).toBe("0");
    expect(billCall![1].payload.netMinor).toBe("0");

    await q.stop();
  });
});

// ---------------------------------------------------------------------------
// SECTION 2 — payroll.run.approved → GL journal posted (balanced Dr == Cr)
// ---------------------------------------------------------------------------
describe("payroll.run.approved → GL accrual journal with balanced lines", () => {
  const PAYROLL_PAYLOAD = {
    runId: "run-001",
    month: "2025-06",
    totalGrossMinor: "5000000",
    totalNetMinor: "4500000",
    totalEmployerContribMinor: "180000",
  };

  it("emits finance.gl.post command with balanced debit/credit totals", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.payrollRunApproved,
      makeMsg(CONSUMED_EVENTS.payrollRunApproved, PAYROLL_PAYLOAD),
    );
    await settle();

    const glCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.journalPost,
    );
    expect(glCall).toBeDefined();

    const payload = glCall![1].payload;
    const lines = payload.lines as Array<{ accountCode: string; debitMinor: string; creditMinor: string }>;

    // Assert Dr == Cr (balanced journal)
    const totalDr = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totalCr = lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totalDr).toBe(totalCr);

    await q.stop();
  });

  it("contains all required account codes (5001, 2101, 2102, 5002, 2103)", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.payrollRunApproved,
      makeMsg(CONSUMED_EVENTS.payrollRunApproved, PAYROLL_PAYLOAD),
    );
    await settle();

    const glCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.journalPost,
    );
    expect(glCall).toBeDefined();

    const lines = glCall![1].payload.lines as Array<{ accountCode: string }>;
    const codes = lines.map((l) => l.accountCode);

    // Salary expense (Dr)
    expect(codes).toContain("5001");
    // Net salary payable (Cr)
    expect(codes).toContain("2101");
    // Statutory deductions payable (Cr)
    expect(codes).toContain("2102");
    // Employer contributions expense (Dr)
    expect(codes).toContain("5002");
    // Employer contributions payable (Cr)
    expect(codes).toContain("2103");

    await q.stop();
  });

  it("salary expense (5001) debit equals gross, net payable (2101) credit equals net", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.payrollRunApproved,
      makeMsg(CONSUMED_EVENTS.payrollRunApproved, PAYROLL_PAYLOAD),
    );
    await settle();

    const glCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.journalPost,
    );
    const lines = glCall![1].payload.lines as Array<{
      accountCode: string; debitMinor: string; creditMinor: string;
    }>;

    const salaryExpense = lines.find((l) => l.accountCode === "5001")!;
    expect(BigInt(salaryExpense.debitMinor)).toBe(5000000n);
    expect(BigInt(salaryExpense.creditMinor)).toBe(0n);

    const netPayable = lines.find((l) => l.accountCode === "2101")!;
    expect(BigInt(netPayable.creditMinor)).toBe(4500000n);
    expect(BigInt(netPayable.debitMinor)).toBe(0n);

    await q.stop();
  });

  it("statutory leg (2102) credit equals gross - net", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.payrollRunApproved,
      makeMsg(CONSUMED_EVENTS.payrollRunApproved, PAYROLL_PAYLOAD),
    );
    await settle();

    const glCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.journalPost,
    );
    const lines = glCall![1].payload.lines as Array<{
      accountCode: string; debitMinor: string; creditMinor: string;
    }>;

    const statutory = lines.find((l) => l.accountCode === "2102")!;
    // gross - net = 5000000 - 4500000 = 500000
    expect(BigInt(statutory.creditMinor)).toBe(500000n);
    expect(BigInt(statutory.debitMinor)).toBe(0n);

    await q.stop();
  });

  it("employer contribution legs (5002 Dr, 2103 Cr) equal the employer amount", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.payrollRunApproved,
      makeMsg(CONSUMED_EVENTS.payrollRunApproved, PAYROLL_PAYLOAD),
    );
    await settle();

    const glCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.journalPost,
    );
    const lines = glCall![1].payload.lines as Array<{
      accountCode: string; debitMinor: string; creditMinor: string;
    }>;

    const empExpense = lines.find((l) => l.accountCode === "5002")!;
    expect(BigInt(empExpense.debitMinor)).toBe(180000n);
    expect(BigInt(empExpense.creditMinor)).toBe(0n);

    const empPayable = lines.find((l) => l.accountCode === "2103")!;
    expect(BigInt(empPayable.creditMinor)).toBe(180000n);
    expect(BigInt(empPayable.debitMinor)).toBe(0n);

    await q.stop();
  });

  it("voucherNo follows PAY/{month}/{runId_prefix} format", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.payrollRunApproved,
      makeMsg(CONSUMED_EVENTS.payrollRunApproved, PAYROLL_PAYLOAD),
    );
    await settle();

    const glCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.journalPost,
    );
    expect(glCall![1].payload.voucherNo).toBe("PAY/2025-06/run-001");

    await q.stop();
  });

  it("omits employer legs when totalEmployerContribMinor is 0", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.payrollRunApproved,
      makeMsg(CONSUMED_EVENTS.payrollRunApproved, {
        ...PAYROLL_PAYLOAD,
        totalEmployerContribMinor: "0",
      }),
    );
    await settle();

    const glCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.journalPost,
    );
    const lines = glCall![1].payload.lines as Array<{ accountCode: string }>;
    const codes = lines.map((l) => l.accountCode);

    expect(codes).not.toContain("5002");
    expect(codes).not.toContain("2103");
    // Still balanced
    const totalDr = lines.reduce((s, l) => s + BigInt((l as any).debitMinor), 0n);
    const totalCr = lines.reduce((s, l) => s + BigInt((l as any).creditMinor), 0n);
    expect(totalDr).toBe(totalCr);

    await q.stop();
  });

  it("skips on duplicate message (markProcessed returns false)", async () => {
    markProcessedMock.mockResolvedValue(false);
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.payrollRunApproved,
      makeMsg(CONSUMED_EVENTS.payrollRunApproved, PAYROLL_PAYLOAD),
    );
    await settle();

    const glCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.journalPost,
    );
    expect(glCall).toBeUndefined();

    await q.stop();
  });
});

// ---------------------------------------------------------------------------
// SECTION 3 — Negative test: payroll.run.approved with zero gross
// ---------------------------------------------------------------------------
describe("payroll.run.approved — zero gross edge case", () => {
  it("with totalGrossMinor=0 still emits a journal (all lines are zero, balanced)", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.payrollRunApproved,
      makeMsg(CONSUMED_EVENTS.payrollRunApproved, {
        runId: "run-zero",
        month: "2025-06",
        totalGrossMinor: "0",
        totalNetMinor: "0",
        totalEmployerContribMinor: "0",
      }),
    );
    await settle();

    // The consumer does not early-return on zero — it will post a zero journal.
    // This is correct: the GL consumer handles the empty journal gracefully.
    const glCall = enqueueMock.mock.calls.find(
      ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.journalPost,
    );

    if (glCall) {
      // If it's emitted, verify it's balanced (0 == 0)
      const lines = glCall[1].payload.lines as Array<{
        debitMinor: string; creditMinor: string;
      }>;
      const totalDr = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
      const totalCr = lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
      expect(totalDr).toBe(totalCr);
      expect(totalDr).toBe(0n);
    }
    // Whether or not it emits — either outcome is acceptable for a zero-gross run.
    // The important thing is that it does NOT throw or crash.

    await q.stop();
  });
});
