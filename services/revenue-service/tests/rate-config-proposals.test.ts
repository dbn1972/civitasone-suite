/**
 * Owner decision #2 (2026-10-26) — GAP-REVENUE-CONFIG-01.
 *
 * Rate configuration is maker-checker, versioned and effective-dated:
 *   - revenue_admin PROPOSES; nothing live changes until a DIFFERENT officer approves
 *   - an approved edit end-dates the old row and inserts the next version (never in place)
 *   - deactivation is an end-date
 *   - the preview shows the effect on a computed demand before approval
 *   - the old direct-write routes are closed by default
 *
 * Consumer half DB-backed, no mocks. Route half mocks only the repo.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { rateHeads, rateSlabs, penaltyRules, rebateRules, configProposals } from "../src/modules/rate-engine/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerRateConfigConsumers } from "../src/modules/rate-config/consumer.js";
import { compute } from "../src/modules/rate-engine/domain.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "ad020000-0000-4000-8000-00000000ad20";
const HEAD = "ad020000-0000-4000-8000-0000000a0a0a";
const SLAB = "ad020000-0000-4000-8000-0000000051ab";
const PEN = "ad020000-0000-4000-8000-0000000be001";
const MAKER = "ad020000-0000-4000-8000-00000000a000";
const CHECKER = "ad020000-0000-4000-8000-0000000c0ec0";

const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
const TODAY = dayOffset(0);
const IN_30 = dayOffset(30);
const IN_60 = dayOffset(60);

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
const msg = (type: string, actorId: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload,
});
async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(configProposals).where(eq(configProposals.tenantId, TENANT));
    await tx.delete(rateSlabs).where(eq(rateSlabs.tenantId, TENANT));
    await tx.delete(penaltyRules).where(eq(penaltyRules.tenantId, TENANT));
    await tx.delete(rebateRules).where(eq(rebateRules.tenantId, TENANT));
    await tx.delete(rateHeads).where(eq(rateHeads.tenantId, TENANT));
  }));
}
async function seed() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(rateHeads).values({ id: HEAD, tenantId: TENANT, code: "PT", name: "Property tax", category: "property_tax", createdBy: MAKER, updatedBy: MAKER });
    await tx.insert(rateSlabs).values({ id: SLAB, tenantId: TENANT, rateHeadId: HEAD, slabType: "flat", rateValue: 100_000n, effectiveFrom: "2026-04-01", createdBy: MAKER, updatedBy: MAKER });
    await tx.insert(penaltyRules).values({ id: PEN, tenantId: TENANT, rateHeadId: HEAD, interestType: "simple", annualRateBps: 1200, graceDays: 0, roundingMode: "floor", createdBy: MAKER, updatedBy: MAKER });
  }));
}
async function start() {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerRateConfigConsumers(q);
  await q.start();
  return q;
}
async function propose(q: MemoryQueue, body: Record<string, unknown>) {
  const id = randomUUID();
  await q.publish(COMMANDS.rateConfigPropose, msg(COMMANDS.rateConfigPropose, MAKER, { id, ...body }));
  await q.drain();
  return id;
}
async function decide(q: MemoryQueue, id: string, actor: string, approve: boolean, reason?: string, actorRoles: string[] | null = ["finance_admin"]) {
  await q.publish(COMMANDS.rateConfigDecide, msg(COMMANDS.rateConfigDecide, actor, { proposalId: id, approve, reason, ...(actorRoles ? { actorRoles } : {}) }));
  await q.drain();
}
const proposalRow = (id: string) => runWithTenant(TENANT, () => db.transaction(async (tx) => (await tx.select().from(configProposals).where(eq(configProposals.id, id)))[0]));
const slabs = () => runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(rateSlabs).where(eq(rateSlabs.tenantId, TENANT))));
const penalties = () => runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(penaltyRules).where(eq(penaltyRules.tenantId, TENANT))));
const audits = () => runWithTenant(TENANT, () => db.transaction(async (tx) =>
  (await tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, "audit.event.record")))).map((a) => a.payload as Record<string, unknown>)));

const REVISE_SLAB = { kind: "rate_slab", action: "revise", targetId: SLAB, rateHeadId: HEAD, effectiveFrom: IN_30, payload: { rateValue: "150000" } };

beforeAll(clean);
beforeEach(async () => { await clean(); await seed(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("rate config is maker-checker (owner decision #2, real DB)", () => {
  it("a proposal is recorded PENDING and changes NOTHING that is live", async () => {
    const q = await start();
    const id = await propose(q, REVISE_SLAB);
    const p = await proposalRow(id);
    expect(p).toMatchObject({ status: "pending", kind: "rate_slab", action: "revise", makerUserId: MAKER, targetId: SLAB });
    const live = await slabs();
    expect(live).toHaveLength(1);
    expect(live[0]!.effectiveTo).toBeNull();
    expect(live[0]!.rateValue).toBe(100_000n);
    await q.stop();
  });

  it("refuses to record a proposal that could never apply (overlapping create) — nothing stored", async () => {
    const q = await start();
    const id = await propose(q, { kind: "rate_slab", action: "create", rateHeadId: HEAD, effectiveFrom: IN_30, payload: { rateHeadId: HEAD, slabType: "flat", rateValue: "1" } });
    expect(await proposalRow(id)).toBeUndefined();
    expect(q.dlq.length).toBeGreaterThan(0);
    await q.stop();
  });

  it("the maker cannot approve their own proposal; it stays pending and nothing changes", async () => {
    const q = await start();
    const id = await propose(q, REVISE_SLAB);
    await decide(q, id, MAKER, true);
    expect(q.dlq.length).toBeGreaterThan(0);
    expect((await proposalRow(id))!.status).toBe("pending");
    expect(await slabs()).toHaveLength(1);
    await q.stop();
  });

  it("a DIFFERENT officer approves a slab revision: the old row is end-dated (not edited) and the next version is inserted", async () => {
    const q = await start();
    const id = await propose(q, REVISE_SLAB);
    await decide(q, id, CHECKER, true, "FY27 tariff order");
    expect(q.dlq).toHaveLength(0);
    const p = (await proposalRow(id))!;
    expect(p).toMatchObject({ status: "approved", checkerUserId: CHECKER, decisionReason: "FY27 tariff order" });
    expect(p.appliedRef).toBeTruthy();
    const rows = (await slabs()).sort((a, b) => a.version - b.version);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: SLAB, rateValue: 100_000n, effectiveTo: IN_30, version: 1 }); // old value untouched, only end-dated
    expect(rows[1]).toMatchObject({ rateValue: 150_000n, effectiveFrom: IN_30, effectiveTo: null, version: 2 });
    const decideAudit = (await audits()).find((a) => a.action === "decide");
    expect(decideAudit).toMatchObject({ resourceType: "rate_config", outcome: "approved", kind: "rate_slab", configAction: "revise", resourceId: id });
    await q.stop();
  });

  it("F2: only revenue_admin or finance_admin may decide in the consumer; every other role (or none) is refused, even a different user", async () => {
    for (const roles of [["revenue_officer"], ["tenant_admin"], ["super_admin"], ["employee"], [], null]) {
      const q = await start();
      const id = await propose(q, REVISE_SLAB);
      const before = q.dlq.length;
      await decide(q, id, CHECKER, true, undefined, roles as string[] | null);
      expect(q.dlq.length, JSON.stringify(roles)).toBeGreaterThan(before);
      expect((await proposalRow(id))!.status, JSON.stringify(roles)).toBe("pending");
      expect(await slabs()).toHaveLength(1);
      await q.stop();
    }
  });

  it("F2: a role-refused REJECT is also refused (the proposal stays pending)", async () => {
    const q = await start();
    const id = await propose(q, REVISE_SLAB);
    await decide(q, id, CHECKER, false, "no", ["revenue_officer"]);
    expect((await proposalRow(id))!.status).toBe("pending");
    await q.stop();
  });

  it("F2: revenue_admin (not the proposer) and finance_admin can both approve", async () => {
    for (const roles of [["revenue_admin"], ["finance_admin"]]) {
      await clean(); await seed();
      const q = await start();
      const id = await propose(q, REVISE_SLAB);
      await decide(q, id, CHECKER, true, undefined, roles);
      expect((await proposalRow(id))!.status, roles[0]).toBe("approved");
      await q.stop();
    }
  });

  it("a rejected proposal changes nothing", async () => {
    const q = await start();
    const id = await propose(q, REVISE_SLAB);
    await decide(q, id, CHECKER, false, "not per the tariff order");
    expect((await proposalRow(id))!.status).toBe("rejected");
    expect(await slabs()).toHaveLength(1);
    await q.stop();
  });

  it("deactivation is an END-DATE: effective_to is set, the row is not deleted, and it stays in force until that date", async () => {
    const q = await start();
    const id = await propose(q, { kind: "penalty_rule", action: "end_date", targetId: PEN, rateHeadId: HEAD, effectiveFrom: IN_60, payload: {} });
    await decide(q, id, CHECKER, true);
    const rows = await penalties();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ effectiveTo: IN_60, isActive: true });
    await q.stop();
  });

  it("an approved penalty revision is honoured by the rate engine ON the effective date, not before", async () => {
    const q = await start();
    const id = await propose(q, { kind: "penalty_rule", action: "revise", targetId: PEN, rateHeadId: HEAD, effectiveFrom: IN_30, payload: { annualRateBps: 2400 } });
    await decide(q, id, CHECKER, true);
    const rules = (await penalties()).map((r) => ({ ...r, interestType: r.interestType as "simple", roundingMode: r.roundingMode as "floor" }));
    const slabRows = await slabs();
    const at = (asOf: string) => compute(slabRows as never, rules as never, [], {
      rateHeadId: HEAD, baseValue: 1_000_000n, asOfDate: asOf, dueDate: new Date(Date.parse(`${asOf}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10), exemptions: [],
    });
    const before = at(dayOffset(29)).interest;
    const after = at(IN_30).interest;
    expect(before > 0n).toBe(true);
    expect(after).toBe(before * 2n); // 24% vs 12% simple interest, same overdue days
    await q.stop();
  });

  it("approval whose change is no longer applicable (target already ended meanwhile) stays pending and is audited, not applied", async () => {
    const q = await start();
    const end = await propose(q, { kind: "rate_slab", action: "end_date", targetId: SLAB, rateHeadId: HEAD, effectiveFrom: IN_30, payload: {} });
    const revise = await propose(q, { ...REVISE_SLAB, effectiveFrom: IN_60 });
    await decide(q, end, CHECKER, true);
    await decide(q, revise, CHECKER, true);
    expect((await proposalRow(revise))!.status).toBe("pending");
    expect(await slabs()).toHaveLength(1);
    expect((await audits()).some((a) => a.outcome === "not_applicable")).toBe(true);
    await q.stop();
  });
});

// ── Route half ───────────────────────────────────────────────────────────────
const R_TENANT = "f1111111-1111-4111-8111-111111111112";
const R_ADMIN = "f2222222-2222-4222-8222-222222222222";
const R_OTHER = "f3333333-3333-4333-8333-333333333332";
const P_PENDING = "f4444444-4444-4444-8444-444444444442";
const P_DONE = "f5555555-5555-4555-8555-555555555552";
// The JWT signing secret is injected by vitest.config.ts (test.env.JWT_SECRET).
const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const tok = (sub: string, roles = ["revenue_admin"]) => ({ authorization: `Bearer ${signToken({ sub, tid: R_TENANT, roles, sid: "s1" }, SECRET, 3600)}` });
const publishSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/modules/rate-config/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/rate-config/repo.js")>();
  const rows: Record<string, Record<string, unknown>> = {
    "f4444444-4444-4444-8444-444444444442": { id: "f4444444-4444-4444-8444-444444444442", tenantId: "f1111111-1111-4111-8111-111111111112", status: "pending", makerUserId: "f2222222-2222-4222-8222-222222222222", kind: "rate_slab", action: "revise", targetId: "t1", rateHeadId: "h1", effectiveFrom: "2099-01-01", payload: { rateValue: "150000" } },
    "f5555555-5555-4555-8555-555555555552": { id: "f5555555-5555-4555-8555-555555555552", tenantId: "f1111111-1111-4111-8111-111111111112", status: "approved", makerUserId: "f2222222-2222-4222-8222-222222222222", kind: "rate_slab", action: "revise", targetId: "t1", rateHeadId: "h1", effectiveFrom: "2099-01-01", payload: {} },
  };
  return {
    ...original,
    findProposalById: vi.fn(async (t: string, id: string) => (rows[id] && rows[id]!.tenantId === t ? rows[id]! : null)),
    listProposals: vi.fn(async (t: string, o: { status?: string }) => {
      const r = Object.values(rows).filter((x) => x.tenantId === t && (!o.status || x.status === o.status));
      return { rows: r, total: r.length };
    }),
    loadConfigState: vi.fn(async () => ({
      heads: [{ id: "h1", code: "PT", name: "PT", category: "property_tax", unitOfMeasure: null, isActive: true, effectiveTo: null, version: 1 }],
      slabs: [{ id: "t1", rateHeadId: "h1", slabType: "flat", bandFrom: null, bandTo: null, rateValue: 100_000n, effectiveFrom: "2026-04-01", effectiveTo: null, isActive: true, version: 1 }],
      penalties: [], rebates: [],
    })),
  };
});
vi.mock("../src/shared/infra.js", () => ({
  cache: { put: vi.fn(), get: vi.fn().mockResolvedValue(null), getOrLoad: vi.fn().mockResolvedValue([]), invalidate: vi.fn() },
  queue: {
    publish: (...a: unknown[]) => publishSpy(...a), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

describe("rate-config routes (owner decision #2)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  const body = { kind: "rate_slab", action: "end_date", effectiveFrom: "2099-12-31", payload: { targetId: randomUUID() } };
  const post = (headers: Record<string, string>, payload: Record<string, unknown> = body) =>
    app.inject({ method: "POST", url: "/v1/revenue/rate-config/proposals", headers, payload });

  it("POST proposals: revenue_admin gets 202 with the proposal id; the command is published", async () => {
    publishSpy.mockClear();
    const res = await post(tok(R_ADMIN));
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
  it("POST proposals: other revenue roles cannot propose (403); 401 without auth; 400 on a bad body; 422 on a past date", async () => {
    expect((await post(tok(R_OTHER, ["revenue_officer"]))).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/revenue/rate-config/proposals", payload: body })).statusCode).toBe(401);
    expect((await post(tok(R_ADMIN), { kind: "bogus" })).statusCode).toBe(400);
    expect((await post(tok(R_ADMIN), { ...body, effectiveFrom: "2020-01-01" })).statusCode).toBe(422);
    expect((await post(tok(R_ADMIN), { kind: "rate_slab", action: "create", effectiveFrom: "2099-01-01", payload: { slabType: "flat" } })).statusCode).toBe(400);
  });
  it("decide: 409 for the maker, 409 when not pending, 404 unknown, 202 for a different officer", async () => {
    const d = (id: string, h: Record<string, string>) => app.inject({ method: "PATCH", url: `/v1/revenue/rate-config/proposals/${id}/decide`, headers: h, payload: { approve: true } });
    expect((await d(P_PENDING, tok(R_ADMIN))).json().error.code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await d(P_DONE, tok(R_OTHER, ["finance_admin"]))).json().error.code).toBe("PROPOSAL_NOT_PENDING");
    expect((await d("f9999999-9999-4999-8999-999999999999", tok(R_OTHER, ["finance_admin"]))).statusCode).toBe(404);
    expect((await d(P_PENDING, tok(R_OTHER, ["finance_admin"]))).statusCode).toBe(202);
    expect((await d(P_PENDING, tok(R_OTHER, ["employee"]))).statusCode).toBe(403);
  });
  it("F2 decide: revenue_officer and tenant_admin are no longer approvers (403, nothing published); the decider roles ride the command", async () => {
    const d = (id: string, h: Record<string, string>, payload: Record<string, unknown> = { approve: true }) => app.inject({ method: "PATCH", url: `/v1/revenue/rate-config/proposals/${id}/decide`, headers: h, payload });
    publishSpy.mockClear();
    for (const r of ["revenue_officer", "tenant_admin", "super_admin"]) {
      expect((await d(P_PENDING, tok(R_OTHER, [r]))).statusCode, r).toBe(403);
    }
    expect(publishSpy).not.toHaveBeenCalled();
    // a client cannot smuggle its own actorRoles through the body
    const res = await d(P_PENDING, tok(R_OTHER, ["finance_admin"]), { approve: true, actorRoles: ["revenue_admin"] });
    expect(res.statusCode).toBe(202);
    expect(publishSpy.mock.calls[0]![1].payload.actorRoles).toEqual(["finance_admin"]);
    // the read-only queue stays visible to revenue officers
    const list = await app.inject({ method: "GET", url: "/v1/revenue/rate-config/proposals", headers: tok(R_OTHER, ["revenue_officer"]) });
    expect(list.statusCode).toBe(200);
  });
  it("list (status filter), get, and PREVIEW before approval", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/revenue/rate-config/proposals?status=pending", headers: tok(R_OTHER, ["finance_admin"]) });
    expect(list.json().data.map((x: { id: string }) => x.id)).toEqual([P_PENDING]);
    expect((await app.inject({ method: "GET", url: `/v1/revenue/rate-config/proposals/${P_PENDING}`, headers: tok(R_OTHER, ["finance_admin"]) })).statusCode).toBe(200);
    const pv = await app.inject({ method: "GET", url: `/v1/revenue/rate-config/proposals/${P_PENDING}/preview`, headers: tok(R_OTHER, ["finance_admin"]) });
    expect(pv.statusCode).toBe(200);
    const data = pv.json().data;
    expect(data.blocked).toBeNull();
    expect(data.sample.before.principal).toBe("100000");
    expect(data.sample.after.principal).toBe("150000");
    expect(data.changes.map((c: { op: string }) => c.op)).toEqual(["update", "insert"]);
  });
  it("the old direct-write routes are CLOSED by default (409 RATE_CONFIG_REQUIRES_APPROVAL)", async () => {
    const saved = process.env.RATE_CONFIG_DIRECT_WRITE_ENABLED;
    delete process.env.RATE_CONFIG_DIRECT_WRITE_ENABLED;
    try {
      const reqs: Array<[string, string, Record<string, unknown>]> = [
        ["POST", "/v1/revenue/rate-heads", { code: "X", name: "X", category: "x" }],
        ["POST", "/v1/revenue/rate-slabs", { rateHeadId: randomUUID(), slabType: "flat", rateValue: "1", effectiveFrom: "2099-01-01" }],
        ["POST", "/v1/revenue/penalty-rules", { rateHeadId: randomUUID(), interestType: "simple", annualRateBps: 100, graceDays: 0, roundingMode: "floor" }],
        ["POST", "/v1/revenue/rebate-rules", { rateHeadId: randomUUID(), rebateType: "early_payment", discountBps: 100, validUntilDaysBeforeDue: 5 }],
        ["PUT", `/v1/revenue/rate-heads/${randomUUID()}/slabs`, { effectiveFrom: "2099-01-01", slabs: [{ slabType: "flat", rateValue: "1" }] }],
      ];
      for (const [method, url, payload] of reqs) {
        const res = await app.inject({ method: method as "POST" | "PUT", url, headers: tok(R_ADMIN), payload });
        expect(res.statusCode, url).toBe(409);
        expect(res.json().error.code, url).toBe("RATE_CONFIG_REQUIRES_APPROVAL");
        // Authorisation runs first: an unauthorised caller must get 403, never a
        // 409 that discloses the policy.
        const denied = await app.inject({ method: method as "POST" | "PUT", url, headers: tok(R_ADMIN, ["employee"]), payload });
        expect(denied.statusCode, `${url} unauthorised`).toBe(403);
      }
      expect(publishSpy).not.toHaveBeenCalledWith(expect.stringMatching(/rate_head\.create|rate_slab\.create/), expect.anything());
    } finally {
      if (saved !== undefined) process.env.RATE_CONFIG_DIRECT_WRITE_ENABLED = saved;
    }
  });
});
