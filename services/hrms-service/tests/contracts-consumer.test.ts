/**
 * Contracts consumer unit tests — comprehensive coverage for all message types.
 * Tests: create, activate, terminate, renewal initiation, renewal decided,
 * bulk renewal, auto-separation, idempotency, and error paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSqlClient } from "./fixtures/mock-sql-client.js";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { uuidV5 } from "../src/shared/ids.js";

const H = vi.hoisted(() => {
  const mockTx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ nextVal: 1 }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
  return {
    mockTx,
    dbTransaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
    markProcessed: vi.fn(async () => true),
    enqueue: vi.fn(async () => undefined),
    getContractById: vi.fn(async () => null),
    getActiveContractForEmployee: vi.fn(async () => null),
    getPendingRenewalForContract: vi.fn(async () => null),
    getNextContractNo: vi.fn(async () => "CON-2025-000001"),
    getRenewalById: vi.fn(async () => null),
    getContractConfig: vi.fn(async () => null),
    getContractHistory: vi.fn(async () => []),
    employeeFindById: vi.fn(async () => null),
    cacheInvalidate: vi.fn(async () => undefined),
    cacheMakeKey: vi.fn((...args: string[]) => args.join(":")),
  };
});

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: H.dbTransaction },
  scopedRead: vi.fn(async (cb: any) => cb(H.mockTx)),
  sqlClient: createMockSqlClient(),
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueue(...a),
  markProcessed: (...a: unknown[]) => H.markProcessed(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: (...a: unknown[]) => H.cacheInvalidate(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKey(...a),
    getOrLoad: vi.fn(async (_k: string, loader: () => Promise<any>) => loader()),
  },
  queue: { subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/modules/contracts/repo.js", () => ({
  getContractById: (...a: unknown[]) => H.getContractById(...a),
  // Tx-scoped variants (fix/hrms-contracts-nested-tx-deadlock): the consumer
  // now reads through its own already-open transaction instead of these
  // scopedRead-based functions, to avoid a nested-transaction connection-
  // pool deadlock under load (.claude/skills/16-production-readiness-audit.md
  // section 1). Forwarded to the SAME underlying mocks as their non-Tx
  // counterparts -- every existing mockResolvedValue/assertion below keeps
  // working unchanged.
  getContractByIdTx: (...a: unknown[]) => H.getContractById(...a),
  getActiveContractForEmployee: (...a: unknown[]) => H.getActiveContractForEmployee(...a),
  getActiveContractForEmployeeTx: (...a: unknown[]) => H.getActiveContractForEmployee(...a),
  getPendingRenewalForContract: (...a: unknown[]) => H.getPendingRenewalForContract(...a),
  getPendingRenewalForContractTx: (...a: unknown[]) => H.getPendingRenewalForContract(...a),
  getNextContractNo: (...a: unknown[]) => H.getNextContractNo(...a),
  getRenewalById: (...a: unknown[]) => H.getRenewalById(...a),
  getRenewalByIdTx: (...a: unknown[]) => H.getRenewalById(...a),
  getContractConfig: (...a: unknown[]) => H.getContractConfig(...a),
  getContractConfigTx: (...a: unknown[]) => H.getContractConfig(...a),
  getContractHistory: (...a: unknown[]) => H.getContractHistory(...a),
  getContractHistoryTx: (...a: unknown[]) => H.getContractHistory(...a),
}));

vi.mock("../src/modules/employee/repo.js", () => ({
  findById: (...a: unknown[]) => H.employeeFindById(...a),
  findByIdTx: (...a: unknown[]) => H.employeeFindById(...a),
}));

import { registerContractConsumers } from "../src/modules/contracts/consumer.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000002";
const EMPLOYEE = "30000000-cccc-4000-8000-000000000003";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  };
}

function makeContract(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    employeeId: EMPLOYEE,
    contractNo: "CON-2025-000001",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    terms: { role: "Consultant", compensationMinor: 5000000n },
    renewalCount: 0,
    status: "active",
    previousContractId: null,
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

function makeRenewal(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    contractId: randomUUID(),
    renewalNumber: 1,
    initiatedBy: ACTOR,
    status: "pending_approval",
    newEndDate: "2026-06-30",
    originalTerms: { role: "Consultant" },
    newTerms: { role: "Senior Consultant" },
    approvalChain: [],
    createdBy: ACTOR,
    updatedBy: ACTOR,
    ...overrides,
  };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 120));

let q: InstanceType<typeof MemoryQueue>;

beforeEach(async () => {
  vi.clearAllMocks();
  H.markProcessed.mockResolvedValue(true);
  H.getContractById.mockResolvedValue(null);
  H.getActiveContractForEmployee.mockResolvedValue(null);
  H.getPendingRenewalForContract.mockResolvedValue(null);
  H.getNextContractNo.mockResolvedValue("CON-2025-000001");
  H.getRenewalById.mockResolvedValue(null);
  H.getContractConfig.mockResolvedValue(null);
  H.getContractHistory.mockResolvedValue([]);
  H.employeeFindById.mockResolvedValue(null);
  q = new MemoryQueue();
  registerContractConsumers(q);
  await q.start();
});

// ─── 1. Idempotency ─────────────────────────────────────────────────────────

describe("idempotency (markProcessed returns false)", () => {
  it("contractCreate: skips if already processed", async () => {
    H.markProcessed.mockResolvedValue(false);
    const id = randomUUID();
    await q.publish(COMMANDS.contractCreate, makeMsg(COMMANDS.contractCreate, {
      id, tenantId: TENANT, employeeId: EMPLOYEE, startDate: "2025-01-01", endDate: "2025-12-31", terms: {},
    }));
    await settle();
    expect(H.employeeFindById).not.toHaveBeenCalled();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("contractActivate: skips if already processed", async () => {
    H.markProcessed.mockResolvedValue(false);
    await q.publish(COMMANDS.contractActivate, makeMsg(COMMANDS.contractActivate, {
      tenantId: TENANT, contractId: randomUUID(),
    }));
    await settle();
    expect(H.getContractById).not.toHaveBeenCalled();
  });

  it("contractTerminate: skips if already processed", async () => {
    H.markProcessed.mockResolvedValue(false);
    await q.publish(COMMANDS.contractTerminate, makeMsg(COMMANDS.contractTerminate, {
      tenantId: TENANT, contractId: randomUUID(),
    }));
    await settle();
    expect(H.getContractById).not.toHaveBeenCalled();
  });

  it("contractRenewalInitiate: skips if already processed", async () => {
    H.markProcessed.mockResolvedValue(false);
    await q.publish(COMMANDS.contractRenewalInitiate, makeMsg(COMMANDS.contractRenewalInitiate, {
      id: randomUUID(), tenantId: TENANT, contractId: randomUUID(), newEndDate: "2026-06-30", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();
    expect(H.getContractById).not.toHaveBeenCalled();
  });

  it("contractRenewalDecided: skips processing if already processed", async () => {
    H.markProcessed.mockResolvedValue(false);
    await q.publish(CONSUMED_EVENTS.contractRenewalDecided, makeMsg(CONSUMED_EVENTS.contractRenewalDecided, {
      tenantId: TENANT, renewalId: randomUUID(), decision: "approved", decidedBy: ACTOR,
    }));
    await settle();
    // No outbox events should be enqueued inside the transaction
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("contractRenewalBulk: per-contract dedup skips an already-processed contract, but the bulk summary audit still fires (review-fix)", async () => {
    // Updated for the review-fix: a single message-level gate that blocked
    // the ENTIRE handler (including the bulk_renewal_complete summary audit)
    // is exactly the silent-incomplete-bulk-operation bug this fix removes
    // (see the long comment above contractRenewalBulk in consumer.ts). The
    // per-contract idempotency key still skips re-validating/re-inserting an
    // already-processed contract with no writes -- that property still
    // holds -- but there is no longer a single blanket gate that also
    // suppresses the summary audit, so it fires and correctly reports this
    // contract as `alreadyProcessed`.
    H.markProcessed.mockResolvedValue(false);
    const c1 = randomUUID();
    await q.publish(COMMANDS.contractRenewalBulk, makeMsg(COMMANDS.contractRenewalBulk, {
      tenantId: TENANT, contractIds: [c1], newEndDate: "2026-06-30", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();
    // Per-contract gate short-circuits BEFORE any contract lookup or write.
    expect(H.getContractById).not.toHaveBeenCalled();
    expect(H.mockTx.insert).not.toHaveBeenCalled();
    const auditCall = H.enqueue.mock.calls.find((c: any) => c[1]?.payload?.action === "bulk_renewal_complete");
    expect(auditCall).toBeDefined();
    expect((auditCall![1] as any).payload.results[0]).toMatchObject({
      contractId: c1,
      success: true,
      alreadyProcessed: true,
    });
  });

  it("contractAutoSeparate: skips if already processed", async () => {
    H.markProcessed.mockResolvedValue(false);
    await q.publish(COMMANDS.contractAutoSeparate, makeMsg(COMMANDS.contractAutoSeparate, {
      tenantId: TENANT, contractId: randomUUID(),
    }));
    await settle();
    expect(H.getContractById).not.toHaveBeenCalled();
  });
});

// ─── 2. contractCreate ───────────────────────────────────────────────────────

describe("contractCreate command", () => {
  it("creates a draft contract for a valid contract-type employee", async () => {
    H.employeeFindById.mockResolvedValue({ id: EMPLOYEE, employeeType: "contract" });
    H.getActiveContractForEmployee.mockResolvedValue(null);
    const id = randomUUID();
    await q.publish(COMMANDS.contractCreate, makeMsg(COMMANDS.contractCreate, {
      id, tenantId: TENANT, employeeId: EMPLOYEE, startDate: "2025-01-01", endDate: "2025-12-31", terms: { role: "Dev" },
    }));
    await settle();
    // Insert called on tx
    expect(H.mockTx.insert).toHaveBeenCalled();
    // Outbox events: contractCreated + audit
    expect(H.enqueue).toHaveBeenCalledTimes(2);
    const topics = H.enqueue.mock.calls.map((c: any) => c[1]?.topic);
    expect(topics).toContain("hrms.contract.created");
    expect(topics).toContain("audit.event.record");
    // Cache invalidated
    expect(H.cacheInvalidate).toHaveBeenCalled();
  });

  it("throws NonRetryableError if employee not found", async () => {
    H.employeeFindById.mockResolvedValue(null);
    const id = randomUUID();
    await q.publish(COMMANDS.contractCreate, makeMsg(COMMANDS.contractCreate, {
      id, tenantId: TENANT, employeeId: EMPLOYEE, startDate: "2025-01-01", endDate: "2025-12-31", terms: {},
    }));
    await settle();
    // Should NOT insert
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError if employee is not contract type", async () => {
    H.employeeFindById.mockResolvedValue({ id: EMPLOYEE, employeeType: "regular" });
    const id = randomUUID();
    await q.publish(COMMANDS.contractCreate, makeMsg(COMMANDS.contractCreate, {
      id, tenantId: TENANT, employeeId: EMPLOYEE, startDate: "2025-01-01", endDate: "2025-12-31", terms: {},
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError if active contract already exists", async () => {
    H.employeeFindById.mockResolvedValue({ id: EMPLOYEE, employeeType: "contract" });
    H.getActiveContractForEmployee.mockResolvedValue(makeContract());
    const id = randomUUID();
    await q.publish(COMMANDS.contractCreate, makeMsg(COMMANDS.contractCreate, {
      id, tenantId: TENANT, employeeId: EMPLOYEE, startDate: "2025-01-01", endDate: "2025-12-31", terms: {},
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });
});

// ─── 3. contractActivate ─────────────────────────────────────────────────────

describe("contractActivate command", () => {
  it("activates a draft contract", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "draft" }));
    await q.publish(COMMANDS.contractActivate, makeMsg(COMMANDS.contractActivate, {
      tenantId: TENANT, contractId,
    }));
    await settle();
    expect(H.mockTx.update).toHaveBeenCalled();
    expect(H.enqueue).toHaveBeenCalledTimes(1); // audit only
    const auditCall = H.enqueue.mock.calls[0]![1] as any;
    expect(auditCall.topic).toBe("audit.event.record");
    expect(auditCall.payload.action).toBe("activate");
    expect(H.cacheInvalidate).toHaveBeenCalled();
  });

  it("throws NonRetryableError if contract not found", async () => {
    H.getContractById.mockResolvedValue(null);
    await q.publish(COMMANDS.contractActivate, makeMsg(COMMANDS.contractActivate, {
      tenantId: TENANT, contractId: randomUUID(),
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError for invalid transition (active → active)", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "active" }));
    await q.publish(COMMANDS.contractActivate, makeMsg(COMMANDS.contractActivate, {
      tenantId: TENANT, contractId,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError for invalid transition (terminated → active)", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "terminated" }));
    await q.publish(COMMANDS.contractActivate, makeMsg(COMMANDS.contractActivate, {
      tenantId: TENANT, contractId,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });
});

// ─── 4. contractTerminate ────────────────────────────────────────────────────

describe("contractTerminate command", () => {
  it("terminates an active contract", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "active" }));
    await q.publish(COMMANDS.contractTerminate, makeMsg(COMMANDS.contractTerminate, {
      tenantId: TENANT, contractId,
    }));
    await settle();
    expect(H.mockTx.update).toHaveBeenCalled();
    expect(H.enqueue).toHaveBeenCalledTimes(1); // audit
    const auditCall = H.enqueue.mock.calls[0]![1] as any;
    expect(auditCall.payload.action).toBe("terminate");
    expect(H.cacheInvalidate).toHaveBeenCalled();
  });

  it("throws NonRetryableError if contract not found", async () => {
    H.getContractById.mockResolvedValue(null);
    await q.publish(COMMANDS.contractTerminate, makeMsg(COMMANDS.contractTerminate, {
      tenantId: TENANT, contractId: randomUUID(),
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError for invalid transition (draft → terminated)", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "draft" }));
    await q.publish(COMMANDS.contractTerminate, makeMsg(COMMANDS.contractTerminate, {
      tenantId: TENANT, contractId,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError for invalid transition (expired → terminated)", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "expired" }));
    await q.publish(COMMANDS.contractTerminate, makeMsg(COMMANDS.contractTerminate, {
      tenantId: TENANT, contractId,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });
});

// ─── 5. contractRenewalInitiate ──────────────────────────────────────────────

describe("contractRenewalInitiate command", () => {
  it("initiates renewal for an active contract", async () => {
    const contractId = randomUUID();
    const renewalId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "active", renewalCount: 0 }));
    H.getPendingRenewalForContract.mockResolvedValue(null);
    H.getContractConfig.mockResolvedValue({ approvalChain: [{ role: "hr_admin" }], maxContractMonths: null });
    H.getContractHistory.mockResolvedValue([]);

    await q.publish(COMMANDS.contractRenewalInitiate, makeMsg(COMMANDS.contractRenewalInitiate, {
      id: renewalId, tenantId: TENANT, contractId, newEndDate: "2026-06-30", newTerms: { role: "Senior" }, initiatedBy: ACTOR,
    }));
    await settle();

    expect(H.mockTx.insert).toHaveBeenCalled();
    // Outbox events: workflow.instance.create + audit
    expect(H.enqueue).toHaveBeenCalledTimes(2);
    const topics = H.enqueue.mock.calls.map((c: any) => c[1]?.topic);
    expect(topics).toContain("workflow.instance.create");
    expect(topics).toContain("audit.event.record");
    expect(H.cacheInvalidate).toHaveBeenCalled();
  });

  it("initiates renewal for an expiring contract", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "expiring" }));
    H.getContractConfig.mockResolvedValue({ approvalChain: [], maxContractMonths: null });
    H.getContractHistory.mockResolvedValue([]);

    await q.publish(COMMANDS.contractRenewalInitiate, makeMsg(COMMANDS.contractRenewalInitiate, {
      id: randomUUID(), tenantId: TENANT, contractId, newEndDate: "2026-06-30", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();
    expect(H.enqueue).toHaveBeenCalled();
  });

  it("transitions escalated contract to expiring before initiating renewal", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "escalated" }));
    H.getContractConfig.mockResolvedValue({ approvalChain: [], maxContractMonths: null });
    H.getContractHistory.mockResolvedValue([]);

    await q.publish(COMMANDS.contractRenewalInitiate, makeMsg(COMMANDS.contractRenewalInitiate, {
      id: randomUUID(), tenantId: TENANT, contractId, newEndDate: "2026-06-30", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();
    // update called to set status to "expiring"
    expect(H.mockTx.update).toHaveBeenCalled();
    expect(H.enqueue).toHaveBeenCalled();
  });

  it("throws NonRetryableError if contract not found", async () => {
    H.getContractById.mockResolvedValue(null);
    await q.publish(COMMANDS.contractRenewalInitiate, makeMsg(COMMANDS.contractRenewalInitiate, {
      id: randomUUID(), tenantId: TENANT, contractId: randomUUID(), newEndDate: "2026-06-30", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError if contract status invalid for renewal (draft)", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "draft" }));
    await q.publish(COMMANDS.contractRenewalInitiate, makeMsg(COMMANDS.contractRenewalInitiate, {
      id: randomUUID(), tenantId: TENANT, contractId, newEndDate: "2026-06-30", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError if contract status invalid for renewal (terminated)", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "terminated" }));
    await q.publish(COMMANDS.contractRenewalInitiate, makeMsg(COMMANDS.contractRenewalInitiate, {
      id: randomUUID(), tenantId: TENANT, contractId, newEndDate: "2026-06-30", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError if pending renewal already exists", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "active" }));
    H.getPendingRenewalForContract.mockResolvedValue(makeRenewal());
    await q.publish(COMMANDS.contractRenewalInitiate, makeMsg(COMMANDS.contractRenewalInitiate, {
      id: randomUUID(), tenantId: TENANT, contractId, newEndDate: "2026-06-30", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError if max contract duration exceeded", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "active" }));
    H.getContractConfig.mockResolvedValue({ approvalChain: [], maxContractMonths: 12 });
    H.getContractHistory.mockResolvedValue([
      { startDate: "2024-01-01", endDate: "2024-12-31" },
      { startDate: "2025-01-01", endDate: "2025-12-31" },
    ]);
    await q.publish(COMMANDS.contractRenewalInitiate, makeMsg(COMMANDS.contractRenewalInitiate, {
      id: randomUUID(), tenantId: TENANT, contractId, newEndDate: "2026-12-31", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });
});

// ─── 6. contractRenewalDecided (approved) ────────────────────────────────────

describe("contractRenewalDecided — approved", () => {
  it("creates new contract, transitions old to renewed, emits contractRenewed event", async () => {
    const renewalId = randomUUID();
    const contractId = randomUUID();
    const renewal = makeRenewal({ id: renewalId, contractId, newEndDate: "2026-06-30", newTerms: { role: "Senior" } });
    const contract = makeContract({ id: contractId, status: "active", renewalCount: 1 });

    H.getRenewalById.mockResolvedValue(renewal);
    H.getContractById.mockResolvedValue(contract);
    H.getNextContractNo.mockResolvedValue("CON-2025-000002");

    await q.publish(CONSUMED_EVENTS.contractRenewalDecided, makeMsg(CONSUMED_EVENTS.contractRenewalDecided, {
      tenantId: TENANT, renewalId, decision: "approved", decidedBy: ACTOR,
    }));
    await settle();

    // tx.update called for: renewal status, renewal newContractId, old contract → renewed
    expect(H.mockTx.update).toHaveBeenCalled();
    // tx.insert called for new contract
    expect(H.mockTx.insert).toHaveBeenCalled();
    // Outbox: contractRenewed event + audit
    expect(H.enqueue).toHaveBeenCalled();
    const topics = H.enqueue.mock.calls.map((c: any) => c[1]?.topic);
    expect(topics).toContain("hrms.contract.renewed");
    expect(topics).toContain("audit.event.record");
    // Cache invalidated
    expect(H.cacheInvalidate).toHaveBeenCalled();
  });

  it("throws NonRetryableError if renewal not found", async () => {
    H.getRenewalById.mockResolvedValue(null);
    await q.publish(CONSUMED_EVENTS.contractRenewalDecided, makeMsg(CONSUMED_EVENTS.contractRenewalDecided, {
      tenantId: TENANT, renewalId: randomUUID(), decision: "approved", decidedBy: ACTOR,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("throws NonRetryableError if associated contract not found", async () => {
    const renewalId = randomUUID();
    H.getRenewalById.mockResolvedValue(makeRenewal({ id: renewalId }));
    H.getContractById.mockResolvedValue(null);
    await q.publish(CONSUMED_EVENTS.contractRenewalDecided, makeMsg(CONSUMED_EVENTS.contractRenewalDecided, {
      tenantId: TENANT, renewalId, decision: "approved", decidedBy: ACTOR,
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });
});

// ─── 7. contractRenewalDecided (rejected) ────────────────────────────────────

describe("contractRenewalDecided — rejected", () => {
  it("sets renewal to rejected and sends notification", async () => {
    const renewalId = randomUUID();
    const contractId = randomUUID();
    const renewal = makeRenewal({ id: renewalId, contractId });
    const contract = makeContract({ id: contractId });

    H.getRenewalById.mockResolvedValue(renewal);
    H.getContractById.mockResolvedValue(contract);

    await q.publish(CONSUMED_EVENTS.contractRenewalDecided, makeMsg(CONSUMED_EVENTS.contractRenewalDecided, {
      tenantId: TENANT, renewalId, decision: "rejected", decidedBy: ACTOR, rejectionReason: "Budget constraints",
    }));
    await settle();

    expect(H.mockTx.update).toHaveBeenCalled();
    // Outbox: notification.send + audit
    expect(H.enqueue).toHaveBeenCalled();
    const topics = H.enqueue.mock.calls.map((c: any) => c[1]?.topic);
    expect(topics).toContain("notification.send");
    expect(topics).toContain("audit.event.record");
    // Verify notification payload mentions rejection
    const notifCall = H.enqueue.mock.calls.find((c: any) => c[1]?.topic === "notification.send");
    expect((notifCall![1] as any).payload.template).toBe("contract_renewal_rejected");
  });
});

// ─── 8. contractRenewalDecided (budget insufficient) ─────────────────────────

describe("contractRenewalDecided — budget insufficient", () => {
  it("sets renewal to budget_insufficient and sends notification", async () => {
    const renewalId = randomUUID();
    const contractId = randomUUID();
    const renewal = makeRenewal({ id: renewalId, contractId });
    const contract = makeContract({ id: contractId });

    H.getRenewalById.mockResolvedValue(renewal);
    H.getContractById.mockResolvedValue(contract);

    await q.publish(CONSUMED_EVENTS.contractRenewalDecided, makeMsg(CONSUMED_EVENTS.contractRenewalDecided, {
      tenantId: TENANT,
      renewalId,
      decision: "approved",
      decidedBy: ACTOR,
      budgetCheck: { available: false, shortfallMinor: 500000, budgetRef: "BUD-2025-001" },
    }));
    await settle();

    expect(H.mockTx.update).toHaveBeenCalled();
    // Outbox: notification + audit
    const topics = H.enqueue.mock.calls.map((c: any) => c[1]?.topic);
    expect(topics).toContain("notification.send");
    expect(topics).toContain("audit.event.record");
    const notifCall = H.enqueue.mock.calls.find((c: any) => c[1]?.topic === "notification.send");
    expect((notifCall![1] as any).payload.template).toBe("contract_renewal_budget_insufficient");
  });
});

// ─── 9. contractRenewalBulk ──────────────────────────────────────────────────

describe("contractRenewalBulk command", () => {
  it("processes multiple contracts and emits bulk audit", async () => {
    const c1 = randomUUID();
    const c2 = randomUUID();
    const contract1 = makeContract({ id: c1, status: "active", renewalCount: 0 });
    const contract2 = makeContract({ id: c2, status: "expiring", renewalCount: 1 });

    H.getContractById
      .mockResolvedValueOnce(contract1)
      .mockResolvedValueOnce(contract2);
    H.getPendingRenewalForContract.mockResolvedValue(null);
    H.getContractConfig.mockResolvedValue({ approvalChain: [], maxContractMonths: null });
    H.getContractHistory.mockResolvedValue([]);

    await q.publish(COMMANDS.contractRenewalBulk, makeMsg(COMMANDS.contractRenewalBulk, {
      tenantId: TENANT, contractIds: [c1, c2], newEndDate: "2026-06-30", newTerms: { role: "Renewed" }, initiatedBy: ACTOR,
    }));
    await settle();

    // Insert called for each renewal
    expect(H.mockTx.insert).toHaveBeenCalled();
    // Final audit for the bulk operation
    expect(H.enqueue).toHaveBeenCalled();
    const auditCall = H.enqueue.mock.calls.find((c: any) => c[1]?.payload?.action === "bulk_renewal_complete");
    expect(auditCall).toBeDefined();
    expect(H.cacheInvalidate).toHaveBeenCalled();
  });

  it("continues processing when one contract fails validation", async () => {
    const c1 = randomUUID();
    const c2 = randomUUID();
    // First contract will fail (not found), second will succeed
    H.getContractById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeContract({ id: c2, status: "active" }));
    H.getPendingRenewalForContract.mockResolvedValue(null);
    H.getContractConfig.mockResolvedValue({ approvalChain: [], maxContractMonths: null });
    H.getContractHistory.mockResolvedValue([]);

    await q.publish(COMMANDS.contractRenewalBulk, makeMsg(COMMANDS.contractRenewalBulk, {
      tenantId: TENANT, contractIds: [c1, c2], newEndDate: "2026-06-30", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();

    // Bulk audit still emitted
    expect(H.enqueue).toHaveBeenCalled();
    const auditCall = H.enqueue.mock.calls.find((c: any) => c[1]?.payload?.action === "bulk_renewal_complete");
    expect(auditCall).toBeDefined();
  });

  it("skips contracts with pending renewals", async () => {
    const c1 = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: c1, status: "active" }));
    H.getPendingRenewalForContract.mockResolvedValue(makeRenewal());
    H.getContractConfig.mockResolvedValue({ approvalChain: [], maxContractMonths: null });

    await q.publish(COMMANDS.contractRenewalBulk, makeMsg(COMMANDS.contractRenewalBulk, {
      tenantId: TENANT, contractIds: [c1], newEndDate: "2026-06-30", newTerms: {}, initiatedBy: ACTOR,
    }));
    await settle();

    // Bulk audit still fires
    expect(H.enqueue).toHaveBeenCalled();
  });

  it("TX-009 regression: redelivering the SAME bulk-renewal message (same messageId) does not duplicate the renewal", async () => {
    // Reproduces a real at-least-once redelivery. Before ANY fix, this
    // handler had no dedup at all: the per-contract "pending renewal already
    // exists" check only protects a contract while its FIRST renewal from
    // this message is still undecided -- it does nothing once that renewal
    // has already resolved one way or the other, which is exactly the case
    // here (H.getPendingRenewalForContract stays null throughout, simulating
    // a redelivery arriving after the first renewal was already decided and
    // is no longer "pending"). Without per-contract dedup this test would
    // show a SECOND insert for c1.
    //
    // review-fix: this is no longer gated by a single message-level
    // markProcessed (see the contractRenewalBulk comment in consumer.ts) --
    // it's gated per-contract, so a full-message redelivery still correctly
    // results in zero new writes for c1, but (unlike the removed early gate)
    // the bulk summary audit fires again, now correctly reporting c1 as
    // `alreadyProcessed` rather than staying silent.
    const c1 = randomUUID();
    const contract1 = makeContract({ id: c1, status: "active", renewalCount: 0 });
    H.getContractById.mockResolvedValue(contract1);
    H.getPendingRenewalForContract.mockResolvedValue(null);
    H.getContractConfig.mockResolvedValue({ approvalChain: [], maxContractMonths: null });
    H.getContractHistory.mockResolvedValue([]);

    const msg = makeMsg(COMMANDS.contractRenewalBulk, {
      tenantId: TENANT, contractIds: [c1], newEndDate: "2026-06-30", newTerms: { role: "Renewed" }, initiatedBy: ACTOR,
    });

    // First delivery: processes normally.
    await q.publish(COMMANDS.contractRenewalBulk, msg);
    await settle();
    const insertsAfterFirst = H.mockTx.insert.mock.calls.length;
    expect(insertsAfterFirst).toBeGreaterThan(0);

    // Redelivery: a REAL at-least-once redelivery is a FRESH consumer
    // process picking the message back up from the broker (e.g. after the
    // original process crashed) -- it shares only the DATABASE's state
    // (here: H.markProcessed's mocked "already seen" state), never the
    // crashed process's in-memory state. Modeled with a fresh MemoryQueue +
    // a fresh registration of the same handler, rather than re-publishing on
    // the SAME queue instance: MemoryQueue has its OWN internal BUS-DEDUP
    // guard (keyed by topic:messageId:subscriberId -- see
    // services/queue-service/src/bus.ts) that silently refuses to redeliver
    // an identical messageId to the same subscriber, which would make this
    // test pass even if the CONSUMER's own per-contract dedup were
    // completely broken -- it would never even reach the handler.
    H.markProcessed.mockResolvedValue(false);
    const q2 = new MemoryQueue();
    registerContractConsumers(q2);
    await q2.start();
    await q2.publish(COMMANDS.contractRenewalBulk, msg);
    await settle();

    // No new renewal insert for c1 -- not duplicated.
    expect(H.mockTx.insert.mock.calls.length).toBe(insertsAfterFirst);
    // The redelivery still gets its own bulk summary audit, correctly
    // reporting c1 as already processed rather than a fresh success.
    const auditCalls = H.enqueue.mock.calls.filter((c: any) => c[1]?.payload?.action === "bulk_renewal_complete");
    expect(auditCalls.length).toBe(2);
    expect((auditCalls[1]![1] as any).payload.results[0]).toMatchObject({
      contractId: c1,
      alreadyProcessed: true,
    });
  });

  it("review-fix regression: a crash after N of M contracts, followed by redelivery of the identical message, resumes the REMAINING contracts instead of silently skipping them", async () => {
    // This is the exact bug the independent review found: the earlier draft
    // of this fix gated the WHOLE handler with one markProcessed(tx,
    // msg.messageId) transaction committed BEFORE the per-contract loop. A
    // crash partway through that loop -- after the early gate had already
    // committed -- meant a redelivery of the identical message saw
    // `isNew = false` and returned immediately, permanently and silently
    // skipping every contract not yet reached. Reproduced here with THREE
    // contracts: c1 and c2 finish (their per-contract keys are already
    // committed, simulating a crash right after c2 and before c3 is ever
    // reached), then the identical message is redelivered.
    const c1 = randomUUID();
    const c2 = randomUUID();
    const c3 = randomUUID();

    H.getContractById.mockResolvedValue(makeContract({ id: c3, status: "active", renewalCount: 0 }));
    H.getPendingRenewalForContract.mockResolvedValue(null);
    H.getContractConfig.mockResolvedValue({ approvalChain: [], maxContractMonths: null });
    H.getContractHistory.mockResolvedValue([]);

    const msg = makeMsg(COMMANDS.contractRenewalBulk, {
      tenantId: TENANT, contractIds: [c1, c2, c3], newEndDate: "2026-06-30", newTerms: { role: "Renewed" }, initiatedBy: ACTOR,
    });

    // Stateful fake standing in for the REAL markProcessed (Postgres
    // `INSERT ... ON CONFLICT DO NOTHING RETURNING`): each unique key can
    // only newly claim once; the SAME key on a later call returns false.
    // Unlike the blanket mockResolvedValue(true/false) used elsewhere in
    // this file, a bulk message's per-contract keys must be tracked
    // individually to simulate a PARTIAL crash correctly.
    const seen = new Set<string>();
    H.markProcessed.mockImplementation(async (..._args: unknown[]) => {
      const key = _args[1] as string;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Pre-seed c1 and c2's per-contract keys as already committed -- the
    // direct consequence of "the process crashed right after c2's own
    // transaction committed, before c3 was ever reached" (markProcessed is
    // the FIRST statement in each per-contract transaction, so "committed"
    // and "key present in `seen`" are the same fact). Computed the same way
    // the consumer derives it, so this precisely reproduces a mid-loop crash
    // without needing to literally interrupt the loop.
    seen.add(uuidV5(`${msg.messageId}:${c1}`));
    seen.add(uuidV5(`${msg.messageId}:${c2}`));

    // Redelivery of the identical message (this IS the "first" call the
    // consumer under test ever sees in this test -- c1/c2's earlier
    // "delivery" is represented entirely by the pre-seeded `seen` set above).
    await q.publish(COMMANDS.contractRenewalBulk, msg);
    await settle();

    // c3 -- never reached before the simulated crash -- was validated and
    // inserted on this redelivery. c1/c2 were not re-validated.
    expect(H.getContractById).toHaveBeenCalledTimes(1);
    expect(H.getContractById).toHaveBeenCalledWith(expect.anything(), TENANT, c3);
    expect(H.mockTx.insert).toHaveBeenCalledTimes(1);

    const auditCall = H.enqueue.mock.calls.find((c: any) => c[1]?.payload?.action === "bulk_renewal_complete");
    expect(auditCall).toBeDefined();
    const summary = (auditCall![1] as any).payload;
    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(3);
    const byContract = Object.fromEntries(summary.results.map((r: any) => [r.contractId, r]));
    // c1/c2: resumed as already-done, NOT reprocessed or duplicated.
    expect(byContract[c1]).toMatchObject({ success: true, alreadyProcessed: true });
    expect(byContract[c2]).toMatchObject({ success: true, alreadyProcessed: true });
    // c3: the remaining contract actually got processed -- not silently
    // skipped, and not flagged as already-done.
    expect(byContract[c3].success).toBe(true);
    expect(byContract[c3].alreadyProcessed).toBeFalsy();
    expect(byContract[c3].renewalId).toBeDefined();
  });
});

// ─── 10. contractAutoSeparate ────────────────────────────────────────────────

describe("contractAutoSeparate command", () => {
  it("expires the contract and emits separation events when auto-separation enabled", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "expiring" }));
    H.getContractConfig.mockResolvedValue({ autoSeparationEnabled: true });

    await q.publish(COMMANDS.contractAutoSeparate, makeMsg(COMMANDS.contractAutoSeparate, {
      tenantId: TENANT, contractId,
    }));
    await settle();

    expect(H.mockTx.update).toHaveBeenCalled();
    // Outbox: lifecycleSeparate + contractSeparated + audit
    expect(H.enqueue).toHaveBeenCalledTimes(3);
    const topics = H.enqueue.mock.calls.map((c: any) => c[1]?.topic);
    expect(topics).toContain("hrms.lifecycle.separate");
    expect(topics).toContain("hrms.contract.separated");
    expect(topics).toContain("audit.event.record");
    expect(H.cacheInvalidate).toHaveBeenCalled();
  });

  it("sends alert notification instead when auto-separation disabled", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "expiring" }));
    H.getContractConfig.mockResolvedValue({ autoSeparationEnabled: false });

    await q.publish(COMMANDS.contractAutoSeparate, makeMsg(COMMANDS.contractAutoSeparate, {
      tenantId: TENANT, contractId,
    }));
    await settle();

    // Should send notification instead of separating
    const topics = H.enqueue.mock.calls.map((c: any) => c[1]?.topic);
    expect(topics).toContain("notification.send");
    expect(topics).toContain("audit.event.record");
    // No lifecycle separate command
    expect(topics).not.toContain("hrms.lifecycle.separate");
    // Check notification template
    const notifCall = H.enqueue.mock.calls.find((c: any) => c[1]?.topic === "notification.send");
    expect((notifCall![1] as any).payload.template).toBe("contract_expiry_alert_no_separation");
  });

  it("defaults to auto-separation enabled when config is null", async () => {
    const contractId = randomUUID();
    H.getContractById.mockResolvedValue(makeContract({ id: contractId, status: "expiring" }));
    H.getContractConfig.mockResolvedValue(null); // No config

    await q.publish(COMMANDS.contractAutoSeparate, makeMsg(COMMANDS.contractAutoSeparate, {
      tenantId: TENANT, contractId,
    }));
    await settle();

    const topics = H.enqueue.mock.calls.map((c: any) => c[1]?.topic);
    expect(topics).toContain("hrms.lifecycle.separate");
    expect(topics).toContain("hrms.contract.separated");
  });

  it("throws NonRetryableError if contract not found", async () => {
    H.getContractById.mockResolvedValue(null);
    await q.publish(COMMANDS.contractAutoSeparate, makeMsg(COMMANDS.contractAutoSeparate, {
      tenantId: TENANT, contractId: randomUUID(),
    }));
    await settle();
    expect(H.enqueue).not.toHaveBeenCalled();
  });
});

// ─── 11. Cache invalidation correctness ──────────────────────────────────────

describe("cache invalidation", () => {
  it("contractCreate invalidates contract, employee-active, employee-history, and dashboard caches", async () => {
    H.employeeFindById.mockResolvedValue({ id: EMPLOYEE, employeeType: "contract" });
    H.getActiveContractForEmployee.mockResolvedValue(null);
    const id = randomUUID();
    await q.publish(COMMANDS.contractCreate, makeMsg(COMMANDS.contractCreate, {
      id, tenantId: TENANT, employeeId: EMPLOYEE, startDate: "2025-01-01", endDate: "2025-12-31", terms: {},
    }));
    await settle();
    // At least 4 cache invalidations
    expect(H.cacheInvalidate.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("contractRenewalDecided (approved) invalidates renewal, dashboard, contract, and employee caches", async () => {
    const renewalId = randomUUID();
    const contractId = randomUUID();
    const renewal = makeRenewal({ id: renewalId, contractId });
    const contract = makeContract({ id: contractId });

    H.getRenewalById.mockResolvedValue(renewal);
    H.getContractById.mockResolvedValue(contract);
    H.getNextContractNo.mockResolvedValue("CON-2025-000003");

    await q.publish(CONSUMED_EVENTS.contractRenewalDecided, makeMsg(CONSUMED_EVENTS.contractRenewalDecided, {
      tenantId: TENANT, renewalId, decision: "approved", decidedBy: ACTOR,
    }));
    await settle();

    // Multiple cache invalidations after transaction
    expect(H.cacheInvalidate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
