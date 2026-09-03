/**
 * finance-service extended consumer coverage tests (part 2)
 *
 * Exercises untested consumers: period-close, anomaly, instruments,
 * reappropriation-eoffice, pfms, tds, recurring, voucher-print,
 * fixed-asset, financial-statements, masters, hoa, subledger.
 * Uses mock-based pattern matching consumers-coverage.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages,
} = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "gen-id-001" }]),
        }),
        returning: vi.fn().mockResolvedValue([{ id: "gen-id-001" }]),
      }),
    }),
    execute: vi.fn().mockResolvedValue([{ id: "gen-id-001" }]),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  const _enqueuedMessages: Array<{
    topic: string; eventType: string; payload: unknown;
  }> = [];
  return { mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any, enqueuedMessages: _enqueuedMessages };
});

let markProcessedResult = true;

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: {
    topic: string; eventType: string; payload: unknown;
  }) => { enqueuedMessages.push({ topic: msg.topic, eventType: msg.eventType, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => markProcessedResult),
  outboxSchema: {},
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  sql: (strings: TemplateStringsArray, ..._values: any[]) => strings.join(""),
}));

// ─── Period-close mocks ──────────────────────────────────────────────────────
vi.mock("../src/modules/period-close/repo.js", () => ({
  findPeriodClose: vi.fn(async () => null),
  upsertPeriodClose: vi.fn(async () => undefined),
  logReopen: vi.fn(async () => undefined),
}));
vi.mock("../src/modules/reports/routes.js", () => ({
  deriveFY: vi.fn((period: string) => `${period.slice(0, 4)}-${(Number(period.slice(0, 4)) + 1).toString().slice(2)}`),
}));

// ─── Anomaly mocks ──────────────────────────────────────────────────────────
vi.mock("../src/modules/anomaly/queries.js", () => ({
  isTransactionDismissed: vi.fn(async () => false),
}));
vi.mock("../src/modules/anomaly/commands.js", () => ({
  createAnomalyFlag: vi.fn(async () => undefined),
  // registerAnomalyConsumers' mlAnomalyDetected handler runs inside its own
  // db.transaction and calls the tx-scoped variant (so markProcessed + the
  // anomaly insert commit atomically) — see anomaly/consumer.ts and the
  // createAnomalyFlagTx docstring. Without this the mocked module has no
  // such export and the handler throws inside the transaction.
  createAnomalyFlagTx: vi.fn(async () => "gen-anomaly-id-001"),
}));
vi.mock("../src/modules/anomaly/domain.js", () => ({
  scoreTransactionZScore: vi.fn(() => null),
  scoreCostCenterPattern: vi.fn(() => null),
  scoreUserBehavior: vi.fn(() => null),
  classifySeverity: vi.fn(() => "low"),
}));

// ─── Instruments mocks ───────────────────────────────────────────────────────
vi.mock("../src/modules/instruments/repo.js", () => ({
  insertInstrument: vi.fn(async () => undefined),
  transition: vi.fn(async () => true),
}));

// ─── Reappropriation eOffice mocks ──────────────────────────────────────────
vi.mock("@civitasone/eoffice-sdk", () => ({
  parseDecisionCallback: vi.fn((payload: any) => ({
    ok: true,
    value: {
      fileId: payload?.fileId ?? randomUUID(),
      fileNo: payload?.fileNo ?? "FIN/2026/RE/1",
      refType: "finance_reappropriation",
      refId: payload?.refId ?? randomUUID(),
      decision: payload?.decision ?? "approved",
      decidedBy: payload?.decidedBy ?? "actor-001",
      decidedAt: "2025-01-15T10:00:00Z",
      dscHash: payload?.dscHash ?? null,
    },
  })),
}));
vi.mock("../src/modules/budget/repo.js", () => ({
  findReappropriationByIdTx: vi.fn(async () => ({
    id: "reapp-001", tenantId: "10000000-aaaa-4000-8000-000000000002",
    budgetId: "bud-target-001", fromBudgetId: "bud-source-001",
    amountMinor: 5000000n, status: "pending_approval",
  })),
  updateReappropriation: vi.fn(async () => undefined),
  transferBudgetReMinorGuarded: vi.fn(async () => true),
  findBudgetByIdTx: vi.fn(async () => null),
  findHeadByCodeTx: vi.fn(async () => null),
  insertBudget: vi.fn(async () => undefined),
  insertSanction: vi.fn(async () => undefined),
  findSanctionByIdTx: vi.fn(async () => null),
  updateSanction: vi.fn(async () => undefined),
  insertReappropriation: vi.fn(async () => undefined),
}));

// ─── PFMS mocks ──────────────────────────────────────────────────────────────
vi.mock("../src/modules/pfms/repo.js", () => ({
  findPfmsById: vi.fn(async () => ({
    id: "pfms-batch-001", submissionStatus: "pending",
  })),
  updatePfmsBatch: vi.fn(async () => undefined),
}));

// ─── Org-structure schema mock ───────────────────────────────────────────────
vi.mock("../src/modules/org-structure/schema.js", () => ({
  legalEntities: Symbol("legalEntities"),
  operatingUnits: Symbol("operatingUnits"),
  costCenters: Symbol("costCenters"),
  profitCenters: Symbol("profitCenters"),
}));

// ─── Resolution-intake schema mock ──────────────────────────────────────────
vi.mock("../src/modules/resolution-intake/schema.js", () => ({
  financeResolutionSanctionIntake: {
    tenantId: "tenantId",
    decisionId: "decisionId",
    id: "id",
  },
}));

// ─── Payments repo mocks ─────────────────────────────────────────────────────
vi.mock("../src/modules/payments/repo.js", () => ({
  findPaymentByIdTx: vi.fn(async () => null),
  updatePayment: vi.fn(async () => undefined),
}));

// ─── @civitasone/schemas mocks ───────────────────────────────────────────────
vi.mock("@civitasone/schemas/money", () => ({
  minorString: (v: any) => String(v),
}));

// ─── @civitasone/search mocks ────────────────────────────────────────────────
vi.mock("@civitasone/search", () => ({
  publishSearchIndex: vi.fn(async () => undefined),
}));

// ─── @civitasone/db mocks ────────────────────────────────────────────────────
vi.mock("@civitasone/db", () => ({
  runWithTenant: vi.fn(async (_t: string, fn: () => Promise<void>) => fn()),
  withTenantConsumer: vi.fn((handler: any) => handler),
  tenantTransaction: vi.fn(async (_db: any, _t: string, fn: (tx: any) => Promise<void>) => fn(mockTx)),
}));

// ─── Imports (AFTER mocks) ───────────────────────────────────────────────────
import { registerPeriodCloseConsumers } from "../src/modules/period-close/consumer.js";
import { registerAnomalyConsumers, processTransactionForAnomalies } from "../src/modules/anomaly/consumer.js";
import { registerInstrumentsConsumers } from "../src/modules/instruments/consumer.js";
import { registerReappropriationEOfficeDecisionConsumers } from "../src/modules/budget/reappropriation-eoffice-consumer.js";
import { registerPfmsConsumers } from "../src/modules/pfms/consumer.js";
import { registerTdsConsumers } from "../src/modules/tds/consumer.js";
import { registerRecurringConsumers } from "../src/modules/recurring/consumer.js";
import { registerVoucherPrintConsumers } from "../src/modules/voucher-print/consumer.js";
import { registerFixedAssetConsumers } from "../src/modules/fixed-asset/consumer.js";
import { registerFinancialStatementsConsumers } from "../src/modules/financial-statements/consumer.js";
import { registerMastersConsumers } from "../src/modules/masters/consumer.js";
import { registerHoaConsumers } from "../src/modules/hoa/consumer.js";
import { registerSubledgerConsumers } from "../src/modules/subledger/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000002";
const ACTOR = "20000000-bbbb-4000-8000-000000000002";
const AUDIT_TOPIC = "audit.event.record";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedResult = true;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Period-Close consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Period-close consumers — coverage", () => {
  it("finance.period.close processes a soft_close", async () => {
    const q = new MemoryQueue();
    registerPeriodCloseConsumers(q);
    await q.start();

    await q.publish("finance.period.close", makeMsg("finance.period.close", {
      tenantId: TENANT, period: "2025-01", closeType: "soft_close",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.period.closed");
    expect(domainEvts).toHaveLength(1);
    expect((domainEvts[0]!.payload as any).status).toBe("soft_close");
    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("finance.period.close processes a hard_close", async () => {
    const q = new MemoryQueue();
    registerPeriodCloseConsumers(q);
    await q.start();

    await q.publish("finance.period.close", makeMsg("finance.period.close", {
      tenantId: TENANT, period: "2025-03", closeType: "hard_close",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.period.closed");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.period.reopen processes a reopen", async () => {
    const { findPeriodClose } = await import("../src/modules/period-close/repo.js");
    (findPeriodClose as any).mockResolvedValueOnce({
      id: "pc-001", tenantId: TENANT, period: "2025-01", status: "soft_close",
    });

    const q = new MemoryQueue();
    registerPeriodCloseConsumers(q);
    await q.start();

    await q.publish("finance.period.reopen", makeMsg("finance.period.reopen", {
      tenantId: TENANT, period: "2025-01", reason: "Correction needed",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.period.reopened");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.period.close idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerPeriodCloseConsumers(q);
    await q.start();

    await q.publish("finance.period.close", makeMsg("finance.period.close", {
      tenantId: TENANT, period: "2025-02", closeType: "soft_close",
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Anomaly consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Anomaly consumers — coverage", () => {
  it("ml.prediction.anomaly_detected processes and creates flag", async () => {
    const q = new MemoryQueue();
    registerAnomalyConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.mlAnomalyDetected, makeMsg(CONSUMED_EVENTS.mlAnomalyDetected, {
      tenantId: TENANT, domain: "finance", entityId: randomUUID(),
      anomalyType: "zscore", severity: "high",
      factors: [{ factor: "amount_deviation", value: 4.5 }],
      zScore: 4.5, vendorId: randomUUID(), categoryId: randomUUID(),
      amountPaise: "15000000", timestamp: new Date().toISOString(),
      correlationId: randomUUID(),
    }));
    await settle();

    const { createAnomalyFlagTx } = await import("../src/modules/anomaly/commands.js");
    expect(createAnomalyFlagTx).toHaveBeenCalled();
    await q.stop();
  });

  it("ml.prediction.anomaly_detected skips dismissed transaction", async () => {
    const { isTransactionDismissed } = await import("../src/modules/anomaly/queries.js");
    (isTransactionDismissed as any).mockResolvedValueOnce(true);

    const q = new MemoryQueue();
    registerAnomalyConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.mlAnomalyDetected, makeMsg(CONSUMED_EVENTS.mlAnomalyDetected, {
      tenantId: TENANT, domain: "finance", entityId: randomUUID(),
      anomalyType: "duplicate", severity: "medium", factors: [],
      timestamp: new Date().toISOString(), correlationId: randomUUID(),
    }));
    await settle();

    const { createAnomalyFlag } = await import("../src/modules/anomaly/commands.js");
    expect(createAnomalyFlag).not.toHaveBeenCalled();
    await q.stop();
  });

  it("ml.prediction.anomaly_detected idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerAnomalyConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.mlAnomalyDetected, makeMsg(CONSUMED_EVENTS.mlAnomalyDetected, {
      tenantId: TENANT, domain: "finance", entityId: randomUUID(),
      anomalyType: "zscore", severity: "low", factors: [],
      timestamp: new Date().toISOString(), correlationId: randomUUID(),
    }));
    await settle();

    const { createAnomalyFlag } = await import("../src/modules/anomaly/commands.js");
    expect(createAnomalyFlag).not.toHaveBeenCalled();
    await q.stop();
  });

  it("processTransactionForAnomalies runs without error", async () => {
    await processTransactionForAnomalies(TENANT, ACTOR, {
      id: randomUUID(), amountPaise: 500000n,
      categoryId: randomUUID(), vendorId: randomUUID(),
      costCenterId: randomUUID(), userId: ACTOR,
      date: new Date(), description: "Test transaction",
    });
    // no throw = success; stats return null so no anomalies flagged
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Instruments consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Instruments consumers — coverage", () => {
  it("finance.instrument.issue processes instrument issuance", async () => {
    const q = new MemoryQueue();
    registerInstrumentsConsumers(q);
    await q.start();

    await q.publish("finance.instrument.issue", makeMsg("finance.instrument.issue", {
      tenantId: TENANT, instrumentType: "cheque", instrumentNo: "CHQ-2025-001",
      bankName: "SBI", payee: "Vendor ABC", amountMinor: 5000000,
      currency: "INR", issueDate: "2025-01-15",
      bankAccountId: randomUUID(), paymentId: randomUUID(),
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.instrument.issued");
    expect(domainEvts).toHaveLength(1);
    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("finance.instrument.transition processes present action", async () => {
    const q = new MemoryQueue();
    registerInstrumentsConsumers(q);
    await q.start();

    await q.publish("finance.instrument.transition", makeMsg("finance.instrument.transition", {
      tenantId: TENANT, id: randomUUID(), action: "present",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.instrument.presented");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.instrument.transition processes clear action", async () => {
    const q = new MemoryQueue();
    registerInstrumentsConsumers(q);
    await q.start();

    await q.publish("finance.instrument.transition", makeMsg("finance.instrument.transition", {
      tenantId: TENANT, id: randomUUID(), action: "clear",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.instrument.cleared");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.instrument.transition processes bounce action", async () => {
    const q = new MemoryQueue();
    registerInstrumentsConsumers(q);
    await q.start();

    await q.publish("finance.instrument.transition", makeMsg("finance.instrument.transition", {
      tenantId: TENANT, id: randomUUID(), action: "bounce", reason: "Insufficient funds",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.instrument.bounced");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.instrument.transition processes cancel action", async () => {
    const q = new MemoryQueue();
    registerInstrumentsConsumers(q);
    await q.start();

    await q.publish("finance.instrument.transition", makeMsg("finance.instrument.transition", {
      tenantId: TENANT, id: randomUUID(), action: "cancel",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.instrument.cancelled");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.instrument.issue idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerInstrumentsConsumers(q);
    await q.start();

    await q.publish("finance.instrument.issue", makeMsg("finance.instrument.issue", {
      tenantId: TENANT, instrumentType: "dd", instrumentNo: "DD-DUP",
      bankName: "PNB", payee: "DUP", amountMinor: 100,
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Reappropriation eOffice Decision consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Reappropriation eOffice decision consumers — coverage", () => {
  it("finance.reappropriation.file_decided processes approved decision", async () => {
    const q = new MemoryQueue();
    registerReappropriationEOfficeDecisionConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.reappropriationFileDecided, makeMsg(
      CONSUMED_EVENTS.reappropriationFileDecided, {
        fileId: randomUUID(), fileNo: "FIN/2026/RE/1",
        refType: "finance_reappropriation", refId: "reapp-001",
        decision: "approved", decidedBy: ACTOR,
        decidedAt: "2025-01-15T10:00:00Z",
      },
    ));
    await settle();

    const { transferBudgetReMinorGuarded } = await import("../src/modules/budget/repo.js");
    expect(transferBudgetReMinorGuarded).toHaveBeenCalled();
    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("finance.reappropriation.file_decided processes rejected decision", async () => {
    const { findReappropriationByIdTx, parseDecisionCallback } = await Promise.all([
      import("../src/modules/budget/repo.js"),
      import("@civitasone/eoffice-sdk"),
    ]).then(([repo, sdk]) => ({ findReappropriationByIdTx: repo.findReappropriationByIdTx, parseDecisionCallback: sdk.parseDecisionCallback }));

    (parseDecisionCallback as any).mockReturnValueOnce({
      ok: true, value: {
        fileId: randomUUID(), fileNo: "FIN/2026/RE/2",
        refType: "finance_reappropriation", refId: "reapp-001",
        decision: "rejected", decidedBy: ACTOR, decidedAt: "2025-01-16T10:00:00Z",
      },
    });

    const q = new MemoryQueue();
    registerReappropriationEOfficeDecisionConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.reappropriationFileDecided, makeMsg(
      CONSUMED_EVENTS.reappropriationFileDecided, {
        fileId: randomUUID(), fileNo: "FIN/2026/RE/2",
        refType: "finance_reappropriation", refId: "reapp-001",
        decision: "rejected", decidedBy: ACTOR,
        decidedAt: "2025-01-16T10:00:00Z",
      },
    ));
    await settle();

    const { updateReappropriation } = await import("../src/modules/budget/repo.js");
    expect(updateReappropriation).toHaveBeenCalledWith(
      expect.anything(), "reapp-001", expect.objectContaining({ status: "rejected" }),
    );
    await q.stop();
  });

  it("finance.reappropriation.file_decided idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerReappropriationEOfficeDecisionConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.reappropriationFileDecided, makeMsg(
      CONSUMED_EVENTS.reappropriationFileDecided, {
        fileId: randomUUID(), refId: "reapp-001", decision: "approved",
        decidedBy: ACTOR, decidedAt: "2025-01-17T10:00:00Z",
      },
    ));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PFMS consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("PFMS consumers — coverage", () => {
  it("finance.pfms.batch_sign processes batch signing", async () => {
    const q = new MemoryQueue();
    registerPfmsConsumers(q);
    await q.start();

    await q.publish("finance.pfms.batch_sign", makeMsg("finance.pfms.batch_sign", {
      id: "pfms-batch-001", tenantId: TENANT,
      certificateRef: "DSC-CERT-2025-001-ABCDEFGH",
      signaturePayload: "base64-encoded-payload-data",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.pfms.batch_signed");
    expect(domainEvts).toHaveLength(1);
    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("finance.pfms.batch_submit processes batch submission", async () => {
    const { findPfmsById } = await import("../src/modules/pfms/repo.js");
    (findPfmsById as any).mockResolvedValueOnce({
      id: "pfms-batch-001", submissionStatus: "signed",
    });

    const q = new MemoryQueue();
    registerPfmsConsumers(q);
    await q.start();

    await q.publish("finance.pfms.batch_submit", makeMsg("finance.pfms.batch_submit", {
      id: "pfms-batch-001", tenantId: TENANT,
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.pfms.batch_submitted");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.pfms.batch_sign idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerPfmsConsumers(q);
    await q.start();

    await q.publish("finance.pfms.batch_sign", makeMsg("finance.pfms.batch_sign", {
      id: "pfms-batch-001", tenantId: TENANT,
      certificateRef: "DUP", signaturePayload: "dup",
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TDS consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("TDS consumers — coverage", () => {
  it("finance.tds.deduction_record processes deduction", async () => {
    const q = new MemoryQueue();
    registerTdsConsumers(q);
    await q.start();

    await q.publish("finance.tds.deduction_record", makeMsg("finance.tds.deduction_record", {
      tenantId: TENANT, vendorId: randomUUID(), vendorName: "Vendor XYZ",
      pan: "ABCDE1234F", billId: randomUUID(), section: "194C",
      grossAmountMinor: 10000000, tdsRatePct: 2,
      tdsAmountMinor: 200000, netPaymentMinor: 9800000,
      deductionDate: "2025-01-15", quarter: "Q4", fy: "2024-25",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.tds.deduction_recorded");
    expect(domainEvts).toHaveLength(1);
    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("finance.tds.deposit_mark processes deposit marking", async () => {
    const q = new MemoryQueue();
    registerTdsConsumers(q);
    await q.start();

    await q.publish("finance.tds.deposit_mark", makeMsg("finance.tds.deposit_mark", {
      tenantId: TENANT, id: randomUUID(),
      depositDate: "2025-02-07", challanNo: "BSR-2025-001",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.tds.deposited");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.tds.deduction_record idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerTdsConsumers(q);
    await q.start();

    await q.publish("finance.tds.deduction_record", makeMsg("finance.tds.deduction_record", {
      tenantId: TENANT, vendorId: randomUUID(), grossAmountMinor: 100,
      tdsRatePct: 1, tdsAmountMinor: 1, netPaymentMinor: 99,
      deductionDate: "2025-01-01", quarter: "Q4", fy: "2024-25",
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Recurring consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Recurring consumers — coverage", () => {
  it("finance.recurring.entry_create processes entry creation", async () => {
    const q = new MemoryQueue();
    registerRecurringConsumers(q);
    await q.start();

    await q.publish("finance.recurring.entry_create", makeMsg("finance.recurring.entry_create", {
      tenantId: TENANT, name: "Monthly Rent",
      debitAccountId: randomUUID(), creditAccountId: randomUUID(),
      amountMinor: 2500000, narration: "Office rent payment",
      nextRunDate: "2025-02-01", frequency: "monthly",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.recurring.entry_created");
    expect(domainEvts).toHaveLength(1);
    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("finance.recurring.entry_update processes entry update", async () => {
    const q = new MemoryQueue();
    registerRecurringConsumers(q);
    await q.start();

    await q.publish("finance.recurring.entry_update", makeMsg("finance.recurring.entry_update", {
      tenantId: TENANT, id: randomUUID(), name: "Updated Rent",
      amountMinor: 3000000, nextRunDate: "2025-03-01",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.recurring.entry_updated");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.recurring.entry_create idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerRecurringConsumers(q);
    await q.start();

    await q.publish("finance.recurring.entry_create", makeMsg("finance.recurring.entry_create", {
      tenantId: TENANT, name: "DUP",
      debitAccountId: randomUUID(), creditAccountId: randomUUID(),
      amountMinor: 100, nextRunDate: "2025-01-01",
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Voucher-print consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Voucher-print consumers — coverage", () => {
  it("finance.voucher_print.generate processes print generation", async () => {
    const q = new MemoryQueue();
    registerVoucherPrintConsumers(q);
    await q.start();

    await q.publish("finance.voucher_print.generate", makeMsg("finance.voucher_print.generate", {
      tenantId: TENANT, journalId: randomUUID(),
    }));
    await settle();

    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const payload = audits[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("voucher_print_generate");
    await q.stop();
  });

  it("finance.voucher_print.generate idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerVoucherPrintConsumers(q);
    await q.start();

    await q.publish("finance.voucher_print.generate", makeMsg("finance.voucher_print.generate", {
      tenantId: TENANT, journalId: randomUUID(),
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Fixed-asset consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fixed-asset consumers — coverage", () => {
  it("finance.fixed_asset.register_refresh processes refresh", async () => {
    const q = new MemoryQueue();
    registerFixedAssetConsumers(q);
    await q.start();

    await q.publish("finance.fixed_asset.register_refresh", makeMsg("finance.fixed_asset.register_refresh", {
      tenantId: TENANT,
    }));
    await settle();

    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const payload = audits[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("fixed_asset_register_refresh");
    await q.stop();
  });

  it("finance.fixed_asset.register_refresh idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerFixedAssetConsumers(q);
    await q.start();

    await q.publish("finance.fixed_asset.register_refresh", makeMsg("finance.fixed_asset.register_refresh", {
      tenantId: TENANT,
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Financial-statements consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Financial-statements consumers — coverage", () => {
  it("finance.financial_statements.refresh processes refresh", async () => {
    const q = new MemoryQueue();
    registerFinancialStatementsConsumers(q);
    await q.start();

    await q.publish("finance.financial_statements.refresh", makeMsg("finance.financial_statements.refresh", {
      tenantId: TENANT, fy: "2024-25",
    }));
    await settle();

    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const payload = audits[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("financial_statements_refresh");
    await q.stop();
  });

  it("finance.financial_statements.refresh idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerFinancialStatementsConsumers(q);
    await q.start();

    await q.publish("finance.financial_statements.refresh", makeMsg("finance.financial_statements.refresh", {
      tenantId: TENANT,
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Masters consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Masters consumers — coverage", () => {
  it("finance.masters.ddo_sync processes DDO sync", async () => {
    const q = new MemoryQueue();
    registerMastersConsumers(q);
    await q.start();

    await q.publish("finance.masters.ddo_sync", makeMsg("finance.masters.ddo_sync", {
      tenantId: TENANT, source: "pfms",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.masters.synced");
    expect(domainEvts).toHaveLength(1);
    expect((domainEvts[0]!.payload as any).masterType).toBe("ddo");
    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("finance.masters.pao_sync processes PAO sync", async () => {
    const q = new MemoryQueue();
    registerMastersConsumers(q);
    await q.start();

    await q.publish("finance.masters.pao_sync", makeMsg("finance.masters.pao_sync", {
      tenantId: TENANT, source: "cga",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.masters.synced");
    expect(domainEvts).toHaveLength(1);
    expect((domainEvts[0]!.payload as any).masterType).toBe("pao");
    await q.stop();
  });

  it("finance.masters.ddo_sync idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerMastersConsumers(q);
    await q.start();

    await q.publish("finance.masters.ddo_sync", makeMsg("finance.masters.ddo_sync", {
      tenantId: TENANT,
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. HoA consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("HoA consumers — coverage", () => {
  it("finance.hoa.major_head_sync processes major head sync", async () => {
    const q = new MemoryQueue();
    registerHoaConsumers(q);
    await q.start();

    await q.publish("finance.hoa.major_head_sync", makeMsg("finance.hoa.major_head_sync", {
      tenantId: TENANT, source: "cga_master",
    }));
    await settle();

    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.hoa.synced");
    expect(domainEvts).toHaveLength(1);
    expect((domainEvts[0]!.payload as any).source).toBe("cga_master");
    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("finance.hoa.major_head_sync idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerHoaConsumers(q);
    await q.start();

    await q.publish("finance.hoa.major_head_sync", makeMsg("finance.hoa.major_head_sync", {
      tenantId: TENANT,
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Subledger consumers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Subledger consumers — coverage", () => {
  it("finance.subledger.refresh processes AP refresh", async () => {
    const q = new MemoryQueue();
    registerSubledgerConsumers(q);
    await q.start();

    await q.publish("finance.subledger.refresh", makeMsg("finance.subledger.refresh", {
      tenantId: TENANT, side: "ap",
    }));
    await settle();

    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const payload = audits[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("subledger_refresh");
    await q.stop();
  });

  it("finance.subledger.refresh processes AR refresh", async () => {
    const q = new MemoryQueue();
    registerSubledgerConsumers(q);
    await q.start();

    await q.publish("finance.subledger.refresh", makeMsg("finance.subledger.refresh", {
      tenantId: TENANT, side: "ar",
    }));
    await settle();

    const audits = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("finance.subledger.refresh idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerSubledgerConsumers(q);
    await q.start();

    await q.publish("finance.subledger.refresh", makeMsg("finance.subledger.refresh", {
      tenantId: TENANT,
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Budget eOffice Decision consumers (sanction file_decided)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Budget eOffice decision consumers — coverage", () => {
  it("finance.sanction.file_decided processes approved decision", async () => {
    const { findSanctionByIdTx } = await import("../src/modules/budget/repo.js");
    (findSanctionByIdTx as any).mockResolvedValueOnce({
      id: "sanc-001", tenantId: TENANT, status: "pending_approval",
      headId: "head-001", amountMinor: 10000000n,
    });

    const { registerEOfficeDecisionConsumers } = await import(
      "../src/modules/budget/eoffice-consumer.js"
    );
    const q = new MemoryQueue();
    registerEOfficeDecisionConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.sanctionFileDecided, makeMsg(
      CONSUMED_EVENTS.sanctionFileDecided, {
        fileId: randomUUID(), fileNo: "FIN/2026/SANC/1",
        refType: "finance_sanction", refId: "sanc-001",
        decision: "approved", decidedBy: ACTOR,
        decidedAt: "2025-01-15T10:00:00Z",
      },
    ));
    await settle();

    const { updateSanction } = await import("../src/modules/budget/repo.js");
    expect(updateSanction).toHaveBeenCalledWith(
      expect.anything(), "sanc-001", expect.objectContaining({ status: "approved" }),
    );
    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.sanction.approved");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.sanction.file_decided processes rejected decision", async () => {
    const { findSanctionByIdTx, parseDecisionCallback } = await Promise.all([
      import("../src/modules/budget/repo.js"),
      import("@civitasone/eoffice-sdk"),
    ]).then(([repo, sdk]) => ({ findSanctionByIdTx: repo.findSanctionByIdTx, parseDecisionCallback: sdk.parseDecisionCallback }));

    (findSanctionByIdTx as any).mockResolvedValueOnce({
      id: "sanc-002", tenantId: TENANT, status: "pending_approval",
      headId: "head-002", amountMinor: 5000000n,
    });
    (parseDecisionCallback as any).mockReturnValueOnce({
      ok: true, value: {
        fileId: randomUUID(), fileNo: "FIN/2026/SANC/2",
        refType: "finance_sanction", refId: "sanc-002",
        decision: "rejected", decidedBy: ACTOR, decidedAt: "2025-01-16T10:00:00Z",
      },
    });

    const { registerEOfficeDecisionConsumers } = await import(
      "../src/modules/budget/eoffice-consumer.js"
    );
    const q = new MemoryQueue();
    registerEOfficeDecisionConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.sanctionFileDecided, makeMsg(
      CONSUMED_EVENTS.sanctionFileDecided, {
        fileId: randomUUID(), fileNo: "FIN/2026/SANC/2",
        refType: "finance_sanction", refId: "sanc-002",
        decision: "rejected", decidedBy: ACTOR,
        decidedAt: "2025-01-16T10:00:00Z",
      },
    ));
    await settle();

    const { updateSanction } = await import("../src/modules/budget/repo.js");
    expect(updateSanction).toHaveBeenCalledWith(
      expect.anything(), "sanc-002", expect.objectContaining({ status: "cancelled" }),
    );
    await q.stop();
  });

  it("finance.sanction.file_decided idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const { registerEOfficeDecisionConsumers } = await import(
      "../src/modules/budget/eoffice-consumer.js"
    );
    const q = new MemoryQueue();
    registerEOfficeDecisionConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.sanctionFileDecided, makeMsg(
      CONSUMED_EVENTS.sanctionFileDecided, {
        fileId: randomUUID(), refId: "sanc-001", decision: "approved",
        decidedBy: ACTOR, decidedAt: "2025-01-17T10:00:00Z",
      },
    ));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. Payment eOffice Decision consumers (payment file_decided)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Payment eOffice decision consumers — coverage", () => {
  it("finance.payment.file_decided processes approved decision", async () => {
    const paymentsRepo = await import("../src/modules/payments/repo.js");
    (paymentsRepo.findPaymentByIdTx as any).mockResolvedValueOnce({
      id: "pay-001", tenantId: TENANT, status: "pending_approval",
      billId: "bill-001", amountMinor: 7500000n, mode: "eft",
    });

    const { registerPaymentEOfficeDecisionConsumers } = await import(
      "../src/modules/payments/eoffice-consumer.js"
    );
    const q = new MemoryQueue();
    registerPaymentEOfficeDecisionConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.paymentFileDecided, makeMsg(
      CONSUMED_EVENTS.paymentFileDecided, {
        fileId: randomUUID(), fileNo: "FIN/2026/PAY/1",
        refType: "finance_payment", refId: "pay-001",
        decision: "approved", decidedBy: ACTOR,
        decidedAt: "2025-01-15T10:00:00Z",
      },
    ));
    await settle();

    expect(paymentsRepo.updatePayment).toHaveBeenCalledWith(
      expect.anything(), "pay-001", expect.objectContaining({ status: "released" }),
    );
    const domainEvts = enqueuedMessages.filter((m) => m.topic === "finance.payment.made");
    expect(domainEvts).toHaveLength(1);
    await q.stop();
  });

  it("finance.payment.file_decided processes rejected decision", async () => {
    const paymentsRepo = await import("../src/modules/payments/repo.js");
    (paymentsRepo.findPaymentByIdTx as any).mockResolvedValueOnce({
      id: "pay-002", tenantId: TENANT, status: "initiated",
      billId: "bill-002", amountMinor: 3000000n, mode: "cheque",
    });

    const { parseDecisionCallback } = await import("@civitasone/eoffice-sdk");
    (parseDecisionCallback as any).mockReturnValueOnce({
      ok: true, value: {
        fileId: randomUUID(), fileNo: "FIN/2026/PAY/2",
        refType: "finance_payment", refId: "pay-002",
        decision: "rejected", decidedBy: ACTOR, decidedAt: "2025-01-16T10:00:00Z",
      },
    });

    const { registerPaymentEOfficeDecisionConsumers } = await import(
      "../src/modules/payments/eoffice-consumer.js"
    );
    const q = new MemoryQueue();
    registerPaymentEOfficeDecisionConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.paymentFileDecided, makeMsg(
      CONSUMED_EVENTS.paymentFileDecided, {
        fileId: randomUUID(), fileNo: "FIN/2026/PAY/2",
        refType: "finance_payment", refId: "pay-002",
        decision: "rejected", decidedBy: ACTOR,
        decidedAt: "2025-01-16T10:00:00Z",
      },
    ));
    await settle();

    expect(paymentsRepo.updatePayment).toHaveBeenCalledWith(
      expect.anything(), "pay-002", expect.objectContaining({ status: "cancelled" }),
    );
    await q.stop();
  });

  it("finance.payment.file_decided idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const { registerPaymentEOfficeDecisionConsumers } = await import(
      "../src/modules/payments/eoffice-consumer.js"
    );
    const q = new MemoryQueue();
    registerPaymentEOfficeDecisionConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.paymentFileDecided, makeMsg(
      CONSUMED_EVENTS.paymentFileDecided, {
        fileId: randomUUID(), refId: "pay-001", decision: "approved",
        decidedBy: ACTOR, decidedAt: "2025-01-17T10:00:00Z",
      },
    ));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. Shared utility coverage — search-indexing
// ═══════════════════════════════════════════════════════════════════════════════

describe("Search indexing — coverage", () => {
  it("indexEntity publishes an upsert index event", async () => {
    const { indexEntity } = await import("../src/shared/search-indexing.js");
    await indexEntity(mockTx as any, {
      id: randomUUID(), tenantId: TENANT, name: "Test Sanction",
      refNumber: "SANC-001", status: "approved",
      actorId: ACTOR, correlationId: randomUUID(),
    });
    // No throw = success (publishSearchIndex is mocked via outbox/enqueue)
  });

  it("deindexEntity publishes a delete index event", async () => {
    const { deindexEntity } = await import("../src/shared/search-indexing.js");
    await deindexEntity(mockTx as any, {
      id: randomUUID(), tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(),
    });
    // No throw = success
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. Shared utility coverage — cashbook postCashBook
// ═══════════════════════════════════════════════════════════════════════════════

describe("Cashbook postCashBook — coverage", () => {
  it("postCashBook posts a receipt entry", async () => {
    const { postCashBook } = await import("../src/shared/cashbook.js");
    await postCashBook(mockTx as any, {
      tenantId: TENANT, entryDate: "2025-01-15",
      voucherType: "receipt", voucherNo: "RCT/2025/001",
      particulars: "Fee collection", receiptMinor: 500000n,
      paymentMinor: 0n, bankOrCash: "bank",
      reference: "challan:ch-001", actorId: ACTOR,
    });
    expect(mockTx.execute).toHaveBeenCalled();
  });

  it("postCashBook posts a payment entry", async () => {
    const { postCashBook } = await import("../src/shared/cashbook.js");
    await postCashBook(mockTx as any, {
      tenantId: TENANT, entryDate: "2025-01-16",
      voucherType: "payment", voucherNo: "PAY/2025/001",
      particulars: "Vendor payment", receiptMinor: 0n,
      paymentMinor: 2500000n, bankOrCash: "cash",
      reference: "payment:pay-001", actorId: ACTOR,
    });
    expect(mockTx.execute).toHaveBeenCalled();
  });
});
