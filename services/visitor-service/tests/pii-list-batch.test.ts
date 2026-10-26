/**
 * CLOS3-S6-15 / CLOS3-S6-16: list reads must (a) be bounded/paginated and (b) write
 * their PII-access audit in a CONSTANT number of statements, not 2 awaited INSERTs
 * per row, while keeping one audit row + one outbox event per returned resource.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Rec = { rows: Record<string, unknown>[] };
const state = vi.hoisted(() => ({
  dataset: [] as Record<string, unknown>[],
  inserts: [] as Rec[],
  selects: 0,
  lastWindow: { limit: -1, offset: -1 },
}));

function fakeTx() {
  const chain: Record<string, unknown> = {};
  let limit = Infinity;
  let offset = 0;
  const c = chain as { from: () => unknown; where: () => unknown; orderBy: () => unknown; limit: (n: number) => unknown; offset: (n: number) => unknown; then: (res: (v: unknown) => unknown) => unknown };
  c.from = () => c; c.where = () => c; c.orderBy = () => c;
  c.limit = (n) => { limit = n; return c; };
  c.offset = (n) => { offset = n; return c; };
  c.then = (res) => { state.lastWindow = { limit, offset }; return Promise.resolve(state.dataset.slice(offset, offset + limit)).then(res); };
  return {
    select: () => { state.selects++; return c; },
    insert: () => ({ values: async (v: unknown) => { state.inserts.push({ rows: (Array.isArray(v) ? v : [v]) as Record<string, unknown>[] }); } }),
  };
}

vi.mock("../src/shared/db.js", () => ({
  db: {},
  scopedRead: vi.fn(async (fn: (tx: unknown) => unknown) => fn(fakeTx())),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), makeKey: vi.fn((...a: unknown[]) => a.join(":")) },
}));

import { listVisitRequests } from "../src/modules/visit-request/repo.js";
import { listBlacklistEntries, listWatchlistEntries } from "../src/modules/blacklist/repo.js";

const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row = (i: number) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, tenantId: TENANT, visitorName: `V${i}`, visitorPhone: "9999999999", status: "approved" });

const auditRows = () => state.inserts.filter((i) => "accessorId" in (i.rows[0] ?? {})).flatMap((i) => i.rows);
const outboxRows = () => state.inserts.filter((i) => "topic" in (i.rows[0] ?? {})).flatMap((i) => i.rows);

beforeEach(() => {
  state.dataset = []; state.inserts = []; state.selects = 0; state.lastWindow = { limit: -1, offset: -1 };
});

describe("listVisitRequests: batched PII audit + pagination (CLOS3-S6-15)", () => {
  it("writes a constant number of INSERT statements regardless of row count", async () => {
    const counts: number[] = [];
    for (const n of [1, 50, 500]) {
      state.dataset = Array.from({ length: n }, (_, i) => row(i)); state.inserts = [];
      await listVisitRequests(TENANT, {}, { actorId: ACTOR, correlationId: "corr" });
      counts.push(state.inserts.length);
    }
    expect(counts).toEqual([2, 2, 2]); // one pii_access_log insert + one outbox insert
  });

  it("keeps one audit row and one outbox event per returned row, with matching ids/purpose", async () => {
    state.dataset = Array.from({ length: 50 }, (_, i) => row(i));
    const { rows } = await listVisitRequests(TENANT, {}, { actorId: ACTOR, correlationId: "corr" });
    const audit = auditRows(); const events = outboxRows();
    expect(audit).toHaveLength(50); expect(events).toHaveLength(50);
    expect(audit.map((a) => a.resourceId)).toEqual(rows.map((r) => r.id));
    expect(new Set(audit.map((a) => a.id)).size).toBe(50); // each row has its own accessId
    for (const a of audit) expect(a).toMatchObject({ tenantId: TENANT, accessorId: ACTOR, resourceType: "visit_request", purpose: "list_view" });
    for (const [i, e] of events.entries()) {
      expect(e).toMatchObject({ topic: "audit.event.record", eventType: "pii.access.logged", tenantId: TENANT, actorId: ACTOR, correlationId: "corr" });
      expect(e.payload).toMatchObject({ accessId: audit[i]!.id, resourceId: audit[i]!.resourceId, resourceType: "visit_request", purpose: "list_view" });
    }
  });

  it("bounds the read: default limit, hasMore, and no audit for the sentinel row", async () => {
    state.dataset = Array.from({ length: 5 }, (_, i) => row(i));
    const page = await listVisitRequests(TENANT, { limit: 3, offset: 0 }, { actorId: ACTOR });
    expect(state.lastWindow).toEqual({ limit: 4, offset: 0 }); // limit + 1 to detect more
    expect(page.rows).toHaveLength(3); expect(page.hasMore).toBe(true);
    expect(auditRows()).toHaveLength(3); // only rows actually returned are audited
    state.inserts = [];
    const last = await listVisitRequests(TENANT, { limit: 3, offset: 3 }, { actorId: ACTOR });
    expect(last.rows).toHaveLength(2); expect(last.hasMore).toBe(false);
    const dflt = await listVisitRequests(TENANT, {}, { actorId: ACTOR });
    expect(state.lastWindow.limit).toBe(501); expect(dflt.hasMore).toBe(false);
  });

  it("clamps an oversized limit to the maximum", async () => {
    await listVisitRequests(TENANT, { limit: 999999 });
    expect(state.lastWindow.limit).toBe(1001);
  });

  it("writes nothing when there are no rows or no PII context", async () => {
    await listVisitRequests(TENANT, {}, { actorId: ACTOR });
    state.dataset = [row(1)];
    await listVisitRequests(TENANT, {});
    expect(state.inserts).toHaveLength(0);
  });
});

describe.each([
  ["blacklist", (piiCtx?: { actorId: string; correlationId?: string }, f: Record<string, unknown> = {}) => listBlacklistEntries(TENANT, f, piiCtx)],
  ["watchlist", (piiCtx?: { actorId: string; correlationId?: string }, f: Record<string, unknown> = {}) => listWatchlistEntries(TENANT, f, piiCtx)],
] as const)("list%s: batched PII audit + pagination (CLOS3-S6-16)", (resourceType, list) => {
  it("writes a constant number of INSERT statements for 1, 50 and 2000 rows", async () => {
    const counts: number[] = [];
    for (const n of [1, 50, 2000]) {
      state.dataset = Array.from({ length: n }, (_, i) => row(i)); state.inserts = [];
      await list({ actorId: ACTOR, correlationId: "corr" }, { limit: 1000 });
      counts.push(state.inserts.length);
    }
    // 1 and 50 rows: one audit + one outbox insert; the 2000-row dataset is capped to
    // the 1000-row page, which still fits a single chunk of each.
    expect(counts).toEqual([2, 2, 2]);
  });

  it("matches the old per-row audit output: one row + event per returned entry", async () => {
    state.dataset = Array.from({ length: 30 }, (_, i) => row(i));
    const { rows } = await list({ actorId: ACTOR, correlationId: "corr" });
    const audit = auditRows(); const events = outboxRows();
    expect(audit.map((a) => a.resourceId)).toEqual(rows.map((r) => r.id));
    expect(events).toHaveLength(30);
    for (const a of audit) expect(a).toMatchObject({ tenantId: TENANT, accessorId: ACTOR, resourceType, purpose: "list_view" });
    for (const [i, e] of events.entries()) {
      expect(e).toMatchObject({ topic: "audit.event.record", eventType: "pii.access.logged", actorId: ACTOR, correlationId: "corr" });
      expect(e.payload).toMatchObject({ accessId: audit[i]!.id, resourceId: audit[i]!.resourceId, resourceType, purpose: "list_view" });
    }
  });

  it("is bounded: limit+1 fetch, hasMore, only returned rows audited", async () => {
    state.dataset = Array.from({ length: 5 }, (_, i) => row(i));
    const page = await list({ actorId: ACTOR }, { limit: 2, offset: 2 });
    expect(state.lastWindow).toEqual({ limit: 3, offset: 2 });
    expect(page.rows).toHaveLength(2); expect(page.hasMore).toBe(true);
    expect(auditRows()).toHaveLength(2);
    await list();
    expect(state.lastWindow.limit).toBe(501);
  });
});
