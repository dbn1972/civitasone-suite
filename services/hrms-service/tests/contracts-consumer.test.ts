/**
 * Contracts consumer unit tests — comprehensive coverage for all message types.
 * Tests: create, activate, terminate, renewal initiation, renewal decided,
 * bulk renewal, auto-separation, idempotency, and error paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

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
  sqlClient: { end: async () => {} },
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
  getActiveContractForEmployee: (...a: unknown[]) => H.getActiveContractForEmployee(...a),
  getPendingRenewalForContract: (...a: unknown[]) => H.getPendingRenewalForContract(...a),
  getNextContractNo: (...a: unknown[]) => H.getNextContractNo(...a),
  getRenewalById: (...a: unknown[]) => H.getRenewalById(...a),
  getContractConfig: (...a: unknown[]) => H.getContractConfig(...a),
  getContractHistory: (...a: unknown[]) => H.getContractHistory(...a),
}));

vi.mock("../src/modules/employee/repo.js", () => ({
  findById: (...a: unknown[]) => H.employeeFindById(...a),
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
