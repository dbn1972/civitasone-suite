/**
 * Orphan-consumer wiring tests.
 * For every previously-orphaned command (published by a route but with no
 * consumer to persist it), assert: publishing the command persists the row,
 * emits the matching EVENT, and is idempotent on redelivery.
 * Also covers SVC-070 closure enforcement + the asset-handover emission.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { EVENTS, COMMANDS } from "../src/topics.js";
import { workScopes, scopeProgress } from "../src/modules/execution/schema.js";
import { awards, tenders, preTenders } from "../src/modules/tender/schema.js";
import { workSplits, workProposals } from "../src/modules/proposal/schema.js";
import { physicalCompletions } from "../src/modules/execution/schema.js";
import { boqItems } from "../src/modules/boq/schema.js";
import { measurements, measurementBooks, bills, billItems } from "../src/modules/billing/schema.js";
import { contractors } from "../src/modules/contractor/schema.js";
import { technicalSanctions } from "../src/modules/approval/schema.js";
import { vi } from "vitest";

const mockInserted: unknown[] = [];
const mockUpdated: unknown[] = [];
const mockDeleted: unknown[] = [];
const mockEnqueued: Array<{ topic: string }> = [];
const mockSelectMap = new Map<unknown, unknown[]>();
let mockMarkResult = true;

function chainRows(rows: unknown[]) {
  const w: any = Promise.resolve(rows);
  w.limit = () => Promise.resolve(rows);
  // Code-review fix (double-billing gap): the MB row lookup in billCreate
  // now chains `.for("update")` before `.limit(1)` — return the same
  // thenable so that chain still resolves to `rows`.
  w.for = () => w;
  return w;
}
const mockTx: any = {
  insert: (t: unknown) => { mockInserted.push(t); return { values: () => Promise.resolve() }; },
  update: (t: unknown) => { mockUpdated.push(t); return { set: () => ({ where: () => Promise.resolve() }) }; },
  delete: (t: unknown) => { mockDeleted.push(t); return { where: () => Promise.resolve() }; },
  select: () => ({
    from: (t: unknown) => ({ where: () => chainRows(mockSelectMap.get(t) ?? []) }),
  }),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: Function) => fn(mockTx) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn((fn: Function) => fn(mockTx)),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn((_k: string, fn: Function) => fn()), invalidate: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(() => Promise.resolve(mockMarkResult)),
  enqueue: vi.fn((_tx: unknown, ev: { topic: string }) => { mockEnqueued.push(ev); return Promise.resolve(); }),
  outboxMessages: {},
  processed: {},
  outboxSchema: {},
}));

const base = {
  messageId: "msg-1",
  tenantId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  correlationId: "corr-1",
  schemaVersion: "1.0",
};

async function handlers(registerName: string, mod: string): Promise<Record<string, Function>> {
  const m = await import(mod);
  const h: Record<string, Function> = {};
  m[registerName]({ subscribe: (t: string, fn: Function) => { h[t] = fn; } });
  return h;
}

beforeEach(() => {
  mockInserted.length = 0; mockUpdated.length = 0; mockDeleted.length = 0; mockEnqueued.length = 0;
  mockSelectMap.clear();
  mockMarkResult = true;
});

function emitted(topic: string): boolean { return mockEnqueued.some((e) => e.topic === topic); }

// ── Proposal: split / coa / office ───────────────────────────────────────
describe("Proposal orphan consumers", () => {
  const load = () => handlers("registerProposalConsumers", "../src/modules/proposal/consumer.js");

  it("proposalSplit persists a split + emits split_created", async () => {
    const h = await load();
    await h[COMMANDS.proposalSplit]({ ...base, payload: { id: "s-1", parentWorkId: "p-1", description: "child" } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.proposalSplit)).toBe(true);
  });
  it("proposalSplit is idempotent on redelivery", async () => {
    mockMarkResult = false;
    const h = await load();
    await h[COMMANDS.proposalSplit]({ ...base, payload: { id: "s-1", parentWorkId: "p-1" } });
    expect(mockInserted).toHaveLength(0);
  });
  it("proposalMapCoa persists mapping + emits coa_mapped", async () => {
    const h = await load();
    await h[COMMANDS.proposalMapCoa]({ ...base, payload: { id: "c-1", workId: "w-1", majorHead: "1234" } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.proposalCoaMapped)).toBe(true);
  });
  it("proposalMapCoa is idempotent", async () => {
    mockMarkResult = false;
    const h = await load();
    await h[COMMANDS.proposalMapCoa]({ ...base, payload: { id: "c-1", workId: "w-1", majorHead: "1234" } });
    expect(mockInserted).toHaveLength(0);
  });
  it("proposalMapOffice persists mapping + emits office_mapped", async () => {
    const h = await load();
    await h[COMMANDS.proposalMapOffice]({ ...base, payload: { id: "o-1", workId: "w-1", divisionId: "d-1", isNodal: true } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.proposalOfficeMapped)).toBe(true);
  });
  it("proposalMapOffice is idempotent", async () => {
    mockMarkResult = false;
    const h = await load();
    await h[COMMANDS.proposalMapOffice]({ ...base, payload: { id: "o-1", workId: "w-1", divisionId: "d-1" } });
    expect(mockInserted).toHaveLength(0);
  });
});

// ── BoQ: update / delete ─────────────────────────────────────────────────
describe("BoQ orphan consumers", () => {
  const load = () => handlers("registerBoqConsumers", "../src/modules/boq/consumer.js");

  it("boqUpdateItem updates existing row + emits item_updated", async () => {
    mockSelectMap.set(boqItems, [{ id: "b-1", rate: 100n, quantity: "5", workId: "w-1" }]);
    const h = await load();
    await h[COMMANDS.boqUpdateItem]({ ...base, payload: { id: "b-1", quantity: 8 } });
    expect(mockUpdated).toHaveLength(1);
    expect(emitted(EVENTS.boqItemUpdated)).toBe(true);
  });
  it("boqUpdateItem rejects a missing row (no update)", async () => {
    mockSelectMap.set(boqItems, []);
    const h = await load();
    await expect(h[COMMANDS.boqUpdateItem]({ ...base, payload: { id: "missing", quantity: 8 } }))
      .rejects.toThrow(/BOQ_ITEM_NOT_FOUND/);
    expect(mockUpdated).toHaveLength(0);
  });
  it("boqUpdateItem is idempotent", async () => {
    mockMarkResult = false;
    const h = await load();
    await h[COMMANDS.boqUpdateItem]({ ...base, payload: { id: "b-1", quantity: 8 } });
    expect(mockUpdated).toHaveLength(0);
  });
  it("boqDeleteItem deletes row + emits item_deleted", async () => {
    const h = await load();
    await h[COMMANDS.boqDeleteItem]({ ...base, payload: { id: "b-1" } });
    expect(mockDeleted).toHaveLength(1);
    expect(emitted(EVENTS.boqItemDeleted)).toBe(true);
  });
  it("boqDeleteItem is idempotent", async () => {
    mockMarkResult = false;
    const h = await load();
    await h[COMMANDS.boqDeleteItem]({ ...base, payload: { id: "b-1" } });
    expect(mockDeleted).toHaveLength(0);
  });
  it("boqDeleteItem is blocked when a measurement references the item (row stays)", async () => {
    mockSelectMap.set(measurements, [{ id: "meas-1", boqItemId: "b-1" }]);
    const h = await load();
    await expect(h[COMMANDS.boqDeleteItem]({ ...base, payload: { id: "b-1" } }))
      .rejects.toThrow(/BOQ_ITEM_DELETE_BLOCKED/);
    expect(mockDeleted).toHaveLength(0);
    expect(emitted(EVENTS.boqItemDeleted)).toBe(false);
  });
  it("boqDeleteItem is blocked when the work has an active award", async () => {
    mockSelectMap.set(measurements, []);
    mockSelectMap.set(boqItems, [{ id: "b-1", workId: "w-1" }]);
    mockSelectMap.set(awards, [{ status: "do_finalized", workId: "w-1" }]);
    const h = await load();
    await expect(h[COMMANDS.boqDeleteItem]({ ...base, payload: { id: "b-1" } }))
      .rejects.toThrow(/BOQ_ITEM_DELETE_BLOCKED/);
    expect(mockDeleted).toHaveLength(0);
  });

  // BR-013/BR-015 consumer-level backstop, added alongside the double-billing
  // fix for defense-in-depth consistency with the rest of this PR.
  it("boqAddItem is rejected when no finalized TS exists for the work (BR-013)", async () => {
    mockSelectMap.set(technicalSanctions, []);
    const h = await load();
    await expect(h[COMMANDS.boqAddItem]({
      ...base,
      payload: { id: "b-new", workId: "w-1", itemDescription: "No TS item", unit: "cum", rate: "1000", quantity: 1 },
    })).rejects.toThrow(/TS_REQUIRED/);
    expect(mockInserted).toHaveLength(0);
  });
  it("boqAddItem persists when a finalized TS exists for the work (BR-013)", async () => {
    mockSelectMap.set(technicalSanctions, [{ workId: "w-1", status: "finalized" }]);
    mockSelectMap.set(boqItems, []);
    const h = await load();
    await h[COMMANDS.boqAddItem]({
      ...base,
      payload: { id: "b-new", workId: "w-1", itemDescription: "Has TS item", unit: "cum", rate: "1000", quantity: 1 },
    });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.boqItemAdded)).toBe(true);
  });
  it("boqUpdateItem is blocked once a pre-tender exists for the work (BR-015)", async () => {
    mockSelectMap.set(boqItems, [{ id: "b-1", rate: 100n, quantity: "5", workId: "w-1" }]);
    mockSelectMap.set(preTenders, [{ id: "pt-1", workId: "w-1" }]);
    const h = await load();
    await expect(h[COMMANDS.boqUpdateItem]({ ...base, payload: { id: "b-1", remarks: "edit after tender" } }))
      .rejects.toThrow(/BOQ_FROZEN/);
    expect(mockUpdated).toHaveLength(0);
  });
  it("boqDeleteItem is blocked once a pre-tender exists for the work (BR-015)", async () => {
    mockSelectMap.set(measurements, []);
    mockSelectMap.set(boqItems, [{ id: "b-1", workId: "w-1" }]);
    mockSelectMap.set(preTenders, [{ id: "pt-1", workId: "w-1" }]);
    const h = await load();
    await expect(h[COMMANDS.boqDeleteItem]({ ...base, payload: { id: "b-1" } }))
      .rejects.toThrow(/BOQ_FROZEN/);
    expect(mockDeleted).toHaveLength(0);
  });
});

// ── Tender: quotation / award dao+do finalize ────────────────────────────
describe("Tender orphan consumers", () => {
  const load = () => handlers("registerTenderConsumers", "../src/modules/tender/consumer.js");

  it("quotationAdd persists quotation + emits quotation.added", async () => {
    // Bug #4: tenderId must resolve to a real tender/pre-tender.
    mockSelectMap.set(preTenders, [{ id: "t-1" }]);
    const h = await load();
    await h[COMMANDS.quotationAdd]({ ...base, payload: { id: "q-1", tenderId: "t-1", contractorName: "ACME", method: "percentage_rate" } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.quotationAdded)).toBe(true);
  });
  it("quotationAdd is idempotent", async () => {
    mockMarkResult = false;
    const h = await load();
    await h[COMMANDS.quotationAdd]({ ...base, payload: { id: "q-1", tenderId: "t-1", contractorName: "ACME", method: "item_rate" } });
    expect(mockInserted).toHaveLength(0);
  });
  it("quotationAdd is rejected when tenderId references neither a tender nor a pre-tender (bug #4)", async () => {
    mockSelectMap.set(tenders, []);
    mockSelectMap.set(preTenders, []);
    const h = await load();
    await expect(h[COMMANDS.quotationAdd]({ ...base, payload: { id: "q-3", tenderId: "nope", contractorName: "ACME", method: "item_rate" } }))
      .rejects.toThrow(/TENDER_NOT_FOUND/);
    expect(mockInserted).toHaveLength(0);
  });
  it("awardCreate persists and resolves contractorId when contractorName matches a registered contractor", async () => {
    mockSelectMap.set(contractors, [{ id: "c-1", name: "ACME Works Ltd" }]);
    const h = await load();
    await h[COMMANDS.awardCreate]({
      ...base,
      payload: { id: "a-2", workId: "w-1", contractorName: "acme works ltd", acceptedAmountMinor: "500000" },
    });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.awardCreated)).toBe(true);
  });
  it("awardCreate is rejected when contractorName matches no registered contractor (bug #4)", async () => {
    mockSelectMap.set(contractors, []);
    const h = await load();
    await expect(h[COMMANDS.awardCreate]({
      ...base,
      payload: { id: "a-3", workId: "w-1", contractorName: "Ghost Co", acceptedAmountMinor: "500000" },
    })).rejects.toThrow(/CONTRACTOR_NOT_FOUND/);
    expect(mockInserted).toHaveLength(0);
  });
  it("awardCreate is rejected when contractorId does not resolve to a registered contractor (bug #4)", async () => {
    mockSelectMap.set(contractors, []);
    const h = await load();
    await expect(h[COMMANDS.awardCreate]({
      ...base,
      payload: { id: "a-4", workId: "w-1", contractorName: "ACME", contractorId: "c-404", acceptedAmountMinor: "500000" },
    })).rejects.toThrow(/CONTRACTOR_NOT_FOUND/);
    expect(mockInserted).toHaveLength(0);
  });
  it("awardCreate is rejected when contractorId resolves but contractorName doesn't match it (bug #4)", async () => {
    mockSelectMap.set(contractors, [{ id: "c-1", name: "ACME Works Ltd" }]);
    const h = await load();
    await expect(h[COMMANDS.awardCreate]({
      ...base,
      payload: { id: "a-5", workId: "w-1", contractorName: "Totally Different Co", contractorId: "c-1", acceptedAmountMinor: "500000" },
    })).rejects.toThrow(/CONTRACTOR_NAME_MISMATCH/);
    expect(mockInserted).toHaveLength(0);
  });
  it("awardDaoFinalize transitions award + emits dao_finalized", async () => {
    const h = await load();
    await h[COMMANDS.awardDaoFinalize]({ ...base, payload: { id: "a-1" } });
    expect(mockUpdated).toHaveLength(1);
    expect(emitted(EVENTS.awardDaoFinalized)).toBe(true);
  });
  it("awardDoFinalize transitions award + emits do_finalized + finalized", async () => {
    const h = await load();
    await h[COMMANDS.awardDoFinalize]({ ...base, payload: { id: "a-1" } });
    expect(mockUpdated).toHaveLength(1);
    expect(emitted(EVENTS.awardDoFinalized)).toBe(true);
    expect(emitted(EVENTS.awardFinalized)).toBe(true);
  });
  it("award finalize is idempotent", async () => {
    mockMarkResult = false;
    const h = await load();
    await h[COMMANDS.awardDaoFinalize]({ ...base, payload: { id: "a-1" } });
    expect(mockUpdated).toHaveLength(0);
  });
});

// ── Execution: scope / progress / photo / physicalComplete ───────────────
describe("Execution orphan consumers", () => {
  const load = () => handlers("registerExecutionConsumers", "../src/modules/execution/consumer.js");

  it("scopeAdd persists scope + emits scope.added", async () => {
    const h = await load();
    await h[COMMANDS.scopeAdd]({ ...base, payload: { id: "sc-1", workId: "w-1", scopeId: "sid" } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.scopeAdded)).toBe(true);
  });
  it("progressRecord within target persists + emits progress.recorded", async () => {
    mockSelectMap.set(workScopes, [{ id: "ws-1", targetValue: "100" }]);
    mockSelectMap.set(scopeProgress, []);
    const h = await load();
    await h[COMMANDS.progressRecord]({ ...base, payload: { id: "pr-1", workScopeId: "ws-1", month: 4, year: 2026, currentAchievement: 50 } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.progressRecorded)).toBe(true);
  });
  it("progressRecord exceeding target is rejected (no insert)", async () => {
    mockSelectMap.set(workScopes, [{ id: "ws-1", targetValue: "100" }]);
    mockSelectMap.set(scopeProgress, [{ currentAchievement: "90" }]);
    const h = await load();
    // Code-review fix (works-cross-entity-integrity #2, HIGH): previously the
    // cap-exceeded path was a bare `return` — no throw, no trace of the
    // dropped request. It now throws a real NonRetryableError (matching
    // billing's dead-letter pattern) so a lost race is at least observable.
    await expect(h[COMMANDS.progressRecord]({ ...base, payload: { id: "pr-2", workScopeId: "ws-1", month: 5, year: 2026, currentAchievement: 20 } }))
      .rejects.toThrow(/PROGRESS_EXCEEDS_TARGET/);
    expect(mockInserted).toHaveLength(0);
  });
  it("photoUpload persists photo + emits photo.uploaded", async () => {
    const h = await load();
    await h[COMMANDS.photoUpload]({ ...base, payload: { id: "ph-1", workId: "w-1", fileKey: "k/1.jpg", source: "mobile" } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.photoUploaded)).toBe(true);
  });
  it("physicalComplete persists certificate + emits physical.completed", async () => {
    const h = await load();
    await h[COMMANDS.physicalComplete]({ ...base, payload: { id: "pc-1", workId: "w-1", certificateFileKey: "cert.pdf" } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.physicalCompleted)).toBe(true);
  });
  it("scopeAdd is idempotent", async () => {
    mockMarkResult = false;
    const h = await load();
    await h[COMMANDS.scopeAdd]({ ...base, payload: { id: "sc-1", workId: "w-1", scopeId: "sid" } });
    expect(mockInserted).toHaveLength(0);
  });
});

// ── SVC-070: workClose enforcement + asset handover ──────────────────────
describe("workClose closure enforcement + asset handover", () => {
  const load = () => handlers("registerExecutionConsumers", "../src/modules/execution/consumer.js");

  it("allows a 'dropped' close on a pre-agreement work (before physical completion)", async () => {
    mockSelectMap.set(awards, []);
    mockSelectMap.set(physicalCompletions, []);
    mockSelectMap.set(workSplits, []);
    const h = await load();
    await h[COMMANDS.workClose]({ ...base, payload: { id: "cl-1", workId: "w-1", closureType: "dropped" } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.workClosed)).toBe(true);
    expect(emitted(EVENTS.assetHandover)).toBe(false);
  });

  it("allows a 'completion' close and emits works.asset.handover", async () => {
    mockSelectMap.set(awards, [{ status: "do_finalized", acceptedAmountMinor: 5000000n }]);
    mockSelectMap.set(physicalCompletions, [{ id: "pc-1" }]);
    mockSelectMap.set(workSplits, []);
    mockSelectMap.set(workProposals, [{ id: "w-1", description: "New road", workNumber: "PWD/2026/0001", estimatedCostMinor: 4000000n }]);
    const h = await load();
    await h[COMMANDS.workClose]({ ...base, payload: { id: "cl-2", workId: "w-1", closureType: "completion" } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.workClosed)).toBe(true);
    expect(emitted(EVENTS.assetHandover)).toBe(true);
  });

  it("rejects a 'completion' close when a parent split is still open (parentSplitConsistency)", async () => {
    mockSelectMap.set(awards, [{ status: "do_finalized", acceptedAmountMinor: 5000000n }]);
    mockSelectMap.set(physicalCompletions, [{ id: "pc-1" }]);
    mockSelectMap.set(workSplits, [{ id: "sp-1", status: "active" }]);
    const h = await load();
    await h[COMMANDS.workClose]({ ...base, payload: { id: "cl-3", workId: "w-1", closureType: "completion" } });
    expect(mockInserted).toHaveLength(0);
    expect(emitted(EVENTS.assetHandover)).toBe(false);
  });

  it("workClose is idempotent on redelivery", async () => {
    mockMarkResult = false;
    const h = await load();
    await h[COMMANDS.workClose]({ ...base, payload: { id: "cl-2", workId: "w-1", closureType: "completion" } });
    expect(mockInserted).toHaveLength(0);
  });
});

// ── Billing: measurement / account compile ───────────────────────────────
describe("Billing orphan consumers", () => {
  const load = () => handlers("registerBillingConsumers", "../src/modules/billing/consumer.js");

  it("measurementRecord within BoQ qty persists + emits measurement.recorded", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", workId: "w-1" }]);
    mockSelectMap.set(boqItems, [{ id: "b-1", workId: "w-1", quantity: "10" }]);
    const h = await load();
    await h[COMMANDS.measurementRecord]({ ...base, payload: { id: "m-1", mbId: "mb-1", boqItemId: "b-1", quantity: 5 } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.measurementRecorded)).toBe(true);
  });
  it("measurementRecord exceeding BoQ qty is rejected (no insert)", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", workId: "w-1" }]);
    mockSelectMap.set(boqItems, [{ id: "b-1", workId: "w-1", quantity: "10" }]);
    const h = await load();
    await expect(h[COMMANDS.measurementRecord]({ ...base, payload: { id: "m-2", mbId: "mb-1", boqItemId: "b-1", quantity: 20 } }))
      .rejects.toThrow(/BOQ_QUANTITY_EXCEEDED/);
    expect(mockInserted).toHaveLength(0);
  });
  it("measurementRecord rejects the second when cumulative quantity exceeds BoQ qty", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", workId: "w-1" }]);
    mockSelectMap.set(boqItems, [{ id: "b-1", workId: "w-1", quantity: "100" }]);
    const h = await load();
    // first 80-unit measurement: no priors → cumulative 80 <= 100 → persists
    mockSelectMap.set(measurements, []);
    await h[COMMANDS.measurementRecord]({ ...base, payload: { id: "m-1", mbId: "mb-1", boqItemId: "b-1", quantity: 80 } });
    expect(mockInserted).toHaveLength(1);
    // second 80-unit measurement: prior 80 + 80 = 160 > 100 → rejected
    mockSelectMap.set(measurements, [{ quantity: "80" }]);
    await expect(h[COMMANDS.measurementRecord]({ ...base, payload: { id: "m-2", mbId: "mb-1", boqItemId: "b-1", quantity: 80 } }))
      .rejects.toThrow(/BOQ_QUANTITY_EXCEEDED/);
    expect(mockInserted).toHaveLength(1); // still 1 — cumulative guard rejected the second
  });
  it("measurementRecord against a missing BoQ item is rejected (no insert)", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", workId: "w-1" }]);
    mockSelectMap.set(boqItems, []);
    const h = await load();
    await expect(h[COMMANDS.measurementRecord]({ ...base, payload: { id: "m-3", mbId: "mb-1", boqItemId: "nope", quantity: 1 } }))
      .rejects.toThrow(/INVALID_BOQ_REF/);
    expect(mockInserted).toHaveLength(0);
  });
  it("measurementRecord against a missing MB is rejected (no insert)", async () => {
    mockSelectMap.set(measurementBooks, []);
    mockSelectMap.set(boqItems, [{ id: "b-1", workId: "w-1", quantity: "10" }]);
    const h = await load();
    await expect(h[COMMANDS.measurementRecord]({ ...base, payload: { id: "m-4", mbId: "missing-mb", boqItemId: "b-1", quantity: 1 } }))
      .rejects.toThrow(/MB_NOT_FOUND/);
    expect(mockInserted).toHaveLength(0);
  });
  // Bug #1 (CRITICAL, works-cross-entity-integrity): the ORIGINAL repro,
  // precisely — a work with ZERO real BoQ items of its own has a measurement
  // recorded against its MB, citing a DIFFERENT work's BoQ item (with its own
  // rate). Previously this was accepted unconditionally: the measurement
  // landed under this work's MB, and the borrowed BoQ item's rate silently
  // became part of THIS work's measured-value ceiling — which a bill against
  // this work is later checked against. No race condition needed; a plain
  // two-call sequential exploit.
  it("measurementRecord is rejected when the cited BoQ item belongs to a different work than the MB (bug #1)", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", workId: "w-1" }]);
    mockSelectMap.set(boqItems, [{ id: "b-borrowed", workId: "some-other-work", quantity: "10", rate: 1000000000n }]);
    const h = await load();
    await expect(h[COMMANDS.measurementRecord]({
      ...base,
      payload: { id: "m-5", mbId: "mb-1", boqItemId: "b-borrowed", quantity: 1 },
    })).rejects.toThrow(/BOQ_WORK_MISMATCH/);
    expect(mockInserted).toHaveLength(0);
  });
  it("accountCompile persists compilation + emits account.compiled", async () => {
    const h = await load();
    await h[COMMANDS.accountCompile]({ ...base, payload: { id: "ac-1", month: 4, year: 2026, submittedTo: "DAG" } });
    expect(mockInserted).toHaveLength(1);
    expect(emitted(EVENTS.accountCompiled)).toBe(true);
  });
  it("accountCompile is idempotent", async () => {
    mockMarkResult = false;
    const h = await load();
    await h[COMMANDS.accountCompile]({ ...base, payload: { id: "ac-1", month: 4, year: 2026 } });
    expect(mockInserted).toHaveLength(0);
  });

  // Bug #2 (defense-in-depth — primary enforcement is the 422 in
  // billing/routes.ts): the cited award must belong to the work being billed.
  it("billCreate is rejected when the cited award does not belong to the work (bug #2)", async () => {
    mockSelectMap.set(awards, [{ id: "award-1", workId: "some-other-work", acceptedAmountMinor: 999999999999n }]);
    const h = await load();
    await expect(h[COMMANDS.billCreate]({
      ...base,
      payload: {
        id: "bill-1", workId: "w-1", awardId: "award-1", mbId: "mb-1",
        billMode: "e_mb", billNumber: "B1", grossAmountMinor: "1000",
      },
    })).rejects.toThrow(/AWARD_WORK_MISMATCH/);
    expect(mockInserted).toHaveLength(0);
  });

  // Bug #1 (no-3-way-match fix): mbId is now required — the ORIGINAL repro
  // ("a work with zero BoQ items and zero measurements ever entered still
  // accepted a bill for the full award value") started here.
  it("billCreate is rejected when no mbId is referenced (bug #1)", async () => {
    mockSelectMap.set(awards, [{ id: "award-1", workId: "w-1", acceptedAmountMinor: 999999999999n }]);
    mockSelectMap.set(bills, []);
    const h = await load();
    await expect(h[COMMANDS.billCreate]({
      ...base,
      payload: {
        id: "bill-4", workId: "w-1", awardId: "award-1",
        billMode: "abstract", billNumber: "B4", grossAmountMinor: "1000",
      },
    })).rejects.toThrow(/MB_REQUIRED/);
    expect(mockInserted).toHaveLength(0);
  });

  // canCreateBill gate (defense-in-depth — primary enforcement is the 409 in
  // billing/routes.ts): billCreate must reject a bill referencing an MB that
  // is not fully finalized (do_finalized), even if the pre-enqueue check
  // was somehow bypassed or the MB's status changed since the HTTP request.
  it("billCreate is rejected when the referenced MB exists but is not do_finalized (canCreateBill gate)", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", status: "draft", workId: "w-1", awardId: "award-1" }]);
    mockSelectMap.set(awards, [{ id: "award-1", workId: "w-1", acceptedAmountMinor: 999999999999n }]);
    const h = await load();
    await expect(h[COMMANDS.billCreate]({
      ...base,
      payload: {
        id: "bill-1", workId: "w-1", awardId: "award-1", mbId: "mb-1",
        billMode: "e_mb", billNumber: "B1", grossAmountMinor: "1000",
      },
    })).rejects.toThrow(/MB_INVALID_STATUS/);
    expect(mockInserted).toHaveLength(0);
  });

  it("billCreate is rejected when the referenced MB does not exist (canCreateBill gate)", async () => {
    mockSelectMap.set(measurementBooks, []);
    mockSelectMap.set(awards, [{ id: "award-1", workId: "w-1", acceptedAmountMinor: 999999999999n }]);
    const h = await load();
    await expect(h[COMMANDS.billCreate]({
      ...base,
      payload: {
        id: "bill-2", workId: "w-1", awardId: "award-1", mbId: "missing-mb",
        billMode: "e_mb", billNumber: "B2", grossAmountMinor: "1000",
      },
    })).rejects.toThrow(/MB_INVALID_STATUS/);
    expect(mockInserted).toHaveLength(0);
  });

  // Bug #1: an MB belonging to a different work/award can't be cited to
  // justify this bill's measured value.
  it("billCreate is rejected when the referenced MB belongs to a different work/award (bug #1)", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", status: "do_finalized", workId: "some-other-work", awardId: "some-other-award" }]);
    mockSelectMap.set(awards, [{ id: "award-1", workId: "w-1", acceptedAmountMinor: 999999999999n }]);
    const h = await load();
    await expect(h[COMMANDS.billCreate]({
      ...base,
      payload: {
        id: "bill-6", workId: "w-1", awardId: "award-1", mbId: "mb-1",
        billMode: "e_mb", billNumber: "B6", grossAmountMinor: "1000",
      },
    })).rejects.toThrow(/MB_WORK_MISMATCH/);
    expect(mockInserted).toHaveLength(0);
  });

  // The ORIGINAL repro, precisely: MB finalized and correctly linked, but
  // zero measurements ever recorded against it — "the full award value"
  // must not be billable against no measured work.
  it("billCreate is rejected when the MB has zero measurements recorded (no work actually measured)", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", status: "do_finalized", workId: "w-1", awardId: "award-1" }]);
    mockSelectMap.set(awards, [{ id: "award-1", workId: "w-1", acceptedAmountMinor: 999999999999n }]);
    mockSelectMap.set(measurements, []);
    const h = await load();
    await expect(h[COMMANDS.billCreate]({
      ...base,
      payload: {
        id: "bill-7", workId: "w-1", awardId: "award-1", mbId: "mb-1",
        billMode: "abstract", billNumber: "B7", grossAmountMinor: "999999999999",
      },
    })).rejects.toThrow(/MEASURED_VALUE_EXCEEDED/);
    expect(mockInserted).toHaveLength(0);
  });

  it("billCreate persists when the MB is do_finalized and measured value covers the bill — and populates bill_items", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", status: "do_finalized", workId: "w-1", awardId: "award-1" }]);
    mockSelectMap.set(awards, [{ id: "award-1", workId: "w-1", acceptedAmountMinor: 999999999999n }]);
    mockSelectMap.set(bills, []);
    // 10 units at 100 paise/unit = 1000 paise measured value.
    mockSelectMap.set(measurements, [{ boqItemId: "boq-1", quantity: "10" }]);
    mockSelectMap.set(boqItems, [{ id: "boq-1", rate: 100n }]);
    const h = await load();
    await h[COMMANDS.billCreate]({
      ...base,
      payload: {
        id: "bill-3", workId: "w-1", awardId: "award-1", mbId: "mb-1",
        billMode: "e_mb", billNumber: "B3", grossAmountMinor: "1000",
      },
    });
    // One insert into `bills`, one into `bill_items` for the single
    // measurement line — the real, queryable bill → BoQ item → measured
    // quantity link the fix requires.
    expect(mockInserted).toHaveLength(2);
    expect(mockInserted).toContain(bills);
    expect(mockInserted).toContain(billItems);
    expect(emitted(EVENTS.billCreated)).toBe(true);
  });

  it("billCreate is rejected when gross amount exceeds the measured value (bug #1)", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", status: "do_finalized", workId: "w-1", awardId: "award-1" }]);
    mockSelectMap.set(awards, [{ id: "award-1", workId: "w-1", acceptedAmountMinor: 999999999999n }]);
    // Measured value is only 1000 paise (10 × 100) — billing 1001 must fail.
    mockSelectMap.set(measurements, [{ boqItemId: "boq-1", quantity: "10" }]);
    mockSelectMap.set(boqItems, [{ id: "boq-1", rate: 100n }]);
    const h = await load();
    await expect(h[COMMANDS.billCreate]({
      ...base,
      payload: {
        id: "bill-8", workId: "w-1", awardId: "award-1", mbId: "mb-1",
        billMode: "e_mb", billNumber: "B8", grossAmountMinor: "1001",
      },
    })).rejects.toThrow(/MEASURED_VALUE_EXCEEDED/);
    expect(mockInserted).toHaveLength(0);
  });

  // Code-review fix: the exact double-billing repro. MB-X measures 1,000,000
  // paise of work. Bill A (gross 1,000,000) already cites MB-X and has been
  // persisted. Bill B, citing the SAME mbId for another 1,000,000, must now
  // be rejected — before this fix it recomputed the identical (unsubtracted)
  // 1,000,000 measured value and passed again, double-paying for the same
  // measured work.
  it("billCreate is rejected when a bill already citing this mbId has already consumed its full measured value (double-billing fix)", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", status: "do_finalized", workId: "w-1", awardId: "award-1" }]);
    mockSelectMap.set(awards, [{ id: "award-1", workId: "w-1", acceptedAmountMinor: 999999999999n }]);
    mockSelectMap.set(measurements, [{ boqItemId: "boq-1", quantity: "10000" }]); // 10000 × 100 = 1,000,000 measured
    mockSelectMap.set(boqItems, [{ id: "boq-1", rate: 100n }]);
    // Bill A already landed, citing mb-1, for the full measured value.
    mockSelectMap.set(bills, [{ id: "bill-A", mbId: "mb-1", grossAmountMinor: 1000000n }]);
    const h = await load();
    await expect(h[COMMANDS.billCreate]({
      ...base,
      payload: {
        id: "bill-B", workId: "w-1", awardId: "award-1", mbId: "mb-1",
        billMode: "e_mb", billNumber: "BILL-B-DOUBLE", grossAmountMinor: "1000000",
      },
    })).rejects.toThrow(/MEASURED_VALUE_EXCEEDED/);
    expect(mockInserted).toHaveLength(0);
  });

  // Same repro, but Bill B asks for only the small remainder of headroom —
  // proves the fix is cumulative (subtracts prior bills against this mb),
  // not a blanket "one bill per MB" block, so legitimate partial/staged RA
  // billing against a single MB still works.
  it("billCreate persists when a bill against a partially-billed mbId fits in the remaining measured-value headroom", async () => {
    mockSelectMap.set(measurementBooks, [{ id: "mb-1", status: "do_finalized", workId: "w-1", awardId: "award-1" }]);
    mockSelectMap.set(awards, [{ id: "award-1", workId: "w-1", acceptedAmountMinor: 999999999999n }]);
    mockSelectMap.set(measurements, [{ boqItemId: "boq-1", quantity: "10000" }]); // 1,000,000 measured
    mockSelectMap.set(boqItems, [{ id: "boq-1", rate: 100n }]);
    // Bill A already took 600,000 of the 1,000,000 measured value.
    mockSelectMap.set(bills, [{ id: "bill-A", mbId: "mb-1", grossAmountMinor: 600000n }]);
    const h = await load();
    await h[COMMANDS.billCreate]({
      ...base,
      payload: {
        id: "bill-C", workId: "w-1", awardId: "award-1", mbId: "mb-1",
        billMode: "e_mb", billNumber: "BILL-C-PARTIAL", grossAmountMinor: "400000",
      },
    });
    expect(mockInserted).toHaveLength(2); // bills + bill_items
    expect(emitted(EVENTS.billCreated)).toBe(true);
  });
});
