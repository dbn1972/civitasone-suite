/**
 * Review-2 CQRS-audit tests for U11-works PATCH edit paths.
 *
 *  - GAP2-WORKS-PROPOSALS-02: PATCH /proposals/:id now routes through the
 *    works.proposal.update consumer, which applies the patch to a DRAFT
 *    proposal and emits an audit.event.record (action=update,
 *    resourceType=proposal) in the SAME transaction. The old PATCH wrote to
 *    Postgres in the route handler with no audit event.
 *  - GAP2-WORKS-CONTRACTORS-03: PATCH /contractors/:id now routes through the
 *    works.contractor.update consumer, which applies the patch and emits an
 *    audit.event.record (action=update, resourceType=contractor) — reporting
 *    only WHICH fields changed, never the clear PAN value (DPDP).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { TENANT_A, ACTOR_A, queueMessage } from "./fixtures/works-fixtures.js";

const mockEnqueued: Array<{ topic: string; payload?: unknown }> = [];
let mockMarkResult = true;
let proposalRow: Record<string, unknown> | null = { id: "p-1", status: "draft" };
let contractorExists = true;

const mockTx: any = {
  select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(proposalRow ? [proposalRow] : []) }) }) }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  insert: () => ({ values: () => Promise.resolve() }),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: Function) => fn(mockTx) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn((fn: Function) => fn(mockTx)),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn((_k: string, fn: Function) => fn()), invalidate: vi.fn(), invalidateResource: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(() => Promise.resolve(mockMarkResult)),
  enqueue: vi.fn((_tx: unknown, ev: { topic: string; payload?: unknown }) => {
    mockEnqueued.push(ev);
    return Promise.resolve();
  }),
  outboxMessages: {}, processed: {}, outboxSchema: {},
}));

// contractor consumer applies via repo.applyContractorUpdate — mock the repo.
vi.mock("../src/modules/contractor/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/contractor/repo.js")>();
  return { ...orig, applyContractorUpdate: vi.fn(async () => contractorExists) };
});

vi.mock("../src/shared/tenant-queue.js", () => ({
  tenantScoped: (q: unknown) => q,
}));

const AUDIT = "audit.event.record";

beforeEach(() => {
  mockEnqueued.length = 0;
  mockMarkResult = true;
  proposalRow = { id: "p-1", status: "draft" };
  contractorExists = true;
});

async function proposalHandlers(): Promise<Record<string, Function>> {
  const { registerProposalConsumers } = await import("../src/modules/proposal/consumer.js");
  const h: Record<string, Function> = {};
  registerProposalConsumers({ subscribe: (t: string, fn: Function) => { h[t] = fn; } } as any);
  return h;
}

async function contractorHandlers(): Promise<Record<string, Function>> {
  const { registerContractorConsumers } = await import("../src/modules/contractor/consumer.js");
  const h: Record<string, Function> = {};
  registerContractorConsumers({ subscribe: (t: string, fn: Function) => { h[t] = fn; } } as any);
  return h;
}

function auditEvent() {
  return mockEnqueued.find((e) => e.topic === AUDIT);
}

describe("GAP2-WORKS-PROPOSALS-02: proposal PATCH is audited via the consumer", () => {
  it("proposalUpdate on a draft emits audit.event.record (action=update, resourceType=proposal)", async () => {
    const h = await proposalHandlers();
    await h[COMMANDS.proposalUpdate]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-prop-upd-1"),
      payload: { id: "p-1", patch: { estimatedCostMinor: "7500000" } },
    });
    const audit = auditEvent();
    expect(audit).toBeDefined();
    expect((audit?.payload as any)?.action).toBe("update");
    expect((audit?.payload as any)?.resourceType).toBe("proposal");
    expect(mockEnqueued.some((e) => e.topic === EVENTS.proposalUpdated)).toBe(true);
  });

  it("proposalUpdate on a non-draft throws (NOT_DRAFT) and emits no audit", async () => {
    proposalRow = { id: "p-1", status: "dao_finalized" };
    const h = await proposalHandlers();
    await expect(
      h[COMMANDS.proposalUpdate]({
        ...queueMessage(TENANT_A, ACTOR_A, "msg-prop-upd-2"),
        payload: { id: "p-1", patch: { estimatedCostMinor: "1" } },
      }),
    ).rejects.toThrow(/NOT_DRAFT/);
    expect(auditEvent()).toBeUndefined();
  });

  it("proposalUpdate is idempotent — duplicate messageId skips (no audit)", async () => {
    mockMarkResult = false;
    const h = await proposalHandlers();
    await h[COMMANDS.proposalUpdate]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-prop-dup"),
      payload: { id: "p-1", patch: { estimatedCostMinor: "1" } },
    });
    expect(auditEvent()).toBeUndefined();
  });
});

describe("GAP2-WORKS-CONTRACTORS-03: contractor PATCH is audited via the consumer", () => {
  it("contractorUpdate emits audit (action=update, resourceType=contractor) with changed field NAMES only", async () => {
    const h = await contractorHandlers();
    await h[COMMANDS.contractorUpdate]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-con-upd-1"),
      payload: { id: "c-1", tenantId: TENANT_A, patch: { name: "Acme Infra", pan: "ABCDE1234F" } },
    });
    const audit = auditEvent();
    expect(audit).toBeDefined();
    expect((audit?.payload as any)?.action).toBe("update");
    expect((audit?.payload as any)?.resourceType).toBe("contractor");
    // Field NAMES are recorded (pan appears as a name), but the clear PAN value never does.
    const fields = (audit?.payload as any)?.fields as string[];
    expect(fields).toContain("pan");
    expect(JSON.stringify(audit?.payload)).not.toContain("ABCDE1234F");
    expect(mockEnqueued.some((e) => e.topic === EVENTS.contractorUpdated)).toBe(true);
  });

  it("contractorUpdate throws when the contractor is absent (no audit)", async () => {
    contractorExists = false;
    const h = await contractorHandlers();
    await expect(
      h[COMMANDS.contractorUpdate]({
        ...queueMessage(TENANT_A, ACTOR_A, "msg-con-upd-2"),
        payload: { id: "missing", tenantId: TENANT_A, patch: { name: "X" } },
      }),
    ).rejects.toThrow(/CONTRACTOR_NOT_FOUND/);
    expect(auditEvent()).toBeUndefined();
  });
});
