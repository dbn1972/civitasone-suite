/**
 * Owner decision #6 (2026-10-26) — GAP-REVENUE-WRITE-OFFS-03.
 *
 * demandId is MANDATORY on new write-offs and the amount is capped at THAT
 * demand's live balance (not the assessee total). Legacy rows (no demand) are
 * left untouched and flagged "legacy, not linked" on reads.
 *
 * Consumer half is DB-backed with no mocks; the route half mocks only the repo.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { writeOffs } from "../src/modules/arrears/schema.js";
import { dcbEntries, demands } from "../src/modules/assessment/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "ad060000-0000-4000-8000-00000000ad60";
const ASSESSEE = "ad060000-0000-4000-8000-0000000000ee";
const OTHER_ASSESSEE = "ad060000-0000-4000-8000-0000000000ef";
const D_SMALL = "ad060000-0000-4000-8000-0000000de111"; // balance 100,000
const D_BIG = "ad060000-0000-4000-8000-0000000de222"; //   balance 900,000
const D_OTHER = "ad060000-0000-4000-8000-0000000de333"; // belongs to OTHER_ASSESSEE
const MAKER = "ad060000-0000-4000-8000-00000000a000";
const CHECKER = "ad060000-0000-4000-8000-0000000c0ec0";
const HEAD = "ad060000-0000-4000-8000-0000000a0a0a";

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
    await tx.delete(writeOffs).where(eq(writeOffs.tenantId, TENANT));
    await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, TENANT));
    await tx.delete(demands).where(eq(demands.tenantId, TENANT));
  }));
}
async function seed() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    for (const [id, assessee, net, fy] of [
      [D_SMALL, ASSESSEE, 100_000n, "2024-2025"],
      [D_BIG, ASSESSEE, 900_000n, "2025-2026"],
      [D_OTHER, OTHER_ASSESSEE, 700_000n, "2025-2026"],
    ] as const) {
      await tx.insert(demands).values({
        id, tenantId: TENANT, assesseeId: assessee, assessmentId: randomUUID(), rateHeadId: HEAD, financialYear: fy,
        dueDate: "2025-06-30", principalMinor: net, netMinor: net, computeSnapshot: {}, createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: assessee, demandId: id, entryType: "demand",
        amountMinor: net, balanceMinor: net, referenceType: "demand", narration: "fixture", createdBy: MAKER,
      });
    }
  }));
}
async function start() {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerArrearsConsumers(q);
  await q.start();
  return q;
}
async function create(q: MemoryQueue, payload: Record<string, unknown>) {
  await q.publish(COMMANDS.writeOffCreate, msg(COMMANDS.writeOffCreate, MAKER, { assesseeId: ASSESSEE, reason: "irrecoverable", ...payload }));
  await q.drain();
}
const rows = () => runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(writeOffs).where(eq(writeOffs.tenantId, TENANT))));

beforeAll(clean);
beforeEach(async () => { await clean(); await seed(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("writeOffCreate consumer — demand-bound cap (owner decision #6)", () => {
  it("records the demand and its authoritative FY (taken from the demand, not the client)", async () => {
    const q = await start();
    await create(q, { demandId: D_SMALL, amountMinor: "100000", financialYear: "1999-2000" });
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]!.demandId).toBe(D_SMALL);
    expect(r[0]!.financialYear).toBe("2024-2025");
    await q.stop();
  });

  it("refuses an amount above THAT demand's balance even though the assessee total would allow it", async () => {
    const q = await start();
    await create(q, { demandId: D_SMALL, amountMinor: "100001" }); // assessee outstanding is 1,000,000
    expect(await rows()).toHaveLength(0);
    expect(q.dlq.length).toBeGreaterThan(0);
    await q.stop();
  });

  it("refuses a demand that belongs to another assessee, or does not exist", async () => {
    const q = await start();
    await create(q, { demandId: D_OTHER, amountMinor: "1000" });
    await create(q, { demandId: randomUUID(), amountMinor: "1000" });
    expect(await rows()).toHaveLength(0);
    await q.stop();
  });

  it("re-checks the demand balance at approval (a later payment blocks the approval; it stays pending)", async () => {
    const q = await start();
    await create(q, { demandId: D_SMALL, amountMinor: "100000" });
    const [wo] = await rows();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: D_SMALL, entryType: "collection",
        amountMinor: 60_000n, balanceMinor: 40_000n, referenceType: "receipt", narration: "paid", createdBy: MAKER,
        createdAt: new Date(Date.now() + 5_000),
      });
    }));
    await q.publish(COMMANDS.writeOffDecide, msg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: wo!.id, approve: true }));
    await q.drain();
    expect((await rows())[0]!.status).toBe("pending");
    await q.stop();
  });

  it("leaves a LEGACY write-off (no demand) decidable against the assessee total — untouched", async () => {
    const legacyId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(writeOffs).values({
        id: legacyId, tenantId: TENANT, assesseeId: ASSESSEE, amountMinor: 50_000n, reason: "legacy",
        status: "pending", makerUserId: MAKER,
      });
    }));
    const q = await start();
    await q.publish(COMMANDS.writeOffDecide, msg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: legacyId, approve: true }));
    await q.drain();
    const r = (await rows()).find((x) => x.id === legacyId)!;
    expect(r.status).toBe("approved");
    expect(r.demandId).toBeNull();
    await q.stop();
  });
});

// ── Route half (repo mocked) ─────────────────────────────────────────────────
const R_TENANT = "f1111111-1111-4111-8111-111111111116";
const R_USER = "f2222222-2222-4222-8222-222222222226";
const R_ASSESSEE = "f3333333-3333-4333-8333-333333333336";
const R_DEMAND = "f4444444-4444-4444-8444-444444444446";
const R_LEGACY = "f5555555-5555-4555-8555-555555555556";
const R_LINKED = "f6666666-6666-4666-8666-666666666666";
const SECRET = "test_secret_for_civitasone_32chr";
const AUTH = { authorization: `Bearer ${signToken({ sub: R_USER, tid: R_TENANT, roles: ["revenue_admin"], sid: "s1" }, SECRET, 3600)}` };

vi.mock("../src/modules/arrears/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/arrears/repo.js")>();
  const store: Record<string, Record<string, unknown>> = {
    "f5555555-5555-4555-8555-555555555556": { id: "f5555555-5555-4555-8555-555555555556", tenantId: "f1111111-1111-4111-8111-111111111116", demandId: null, status: "pending", amountMinor: 1n, reason: "old" },
    "f6666666-6666-4666-8666-666666666666": { id: "f6666666-6666-4666-8666-666666666666", tenantId: "f1111111-1111-4111-8111-111111111116", demandId: "f4444444-4444-4444-8444-444444444446", status: "pending", amountMinor: 1n, reason: "new" },
  };
  return {
    ...original,
    getWriteOffTarget: vi.fn(async (_t: string, demandId: string) =>
      demandId === "f4444444-4444-4444-8444-444444444446"
        ? { assesseeId: "f3333333-3333-4333-8333-333333333336", financialYear: "2025-2026", balanceMinor: 500_000n }
        : null),
    findWriteOffById: vi.fn(async (t: string, id: string) => (store[id] && store[id]!.tenantId === t ? store[id]! : null)),
    listWriteOffs: vi.fn(async () => ({ rows: Object.values(store), total: 2 })),
  };
});

describe("write-off routes — demand mandatory + legacy flag (owner decision #6)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  const body = (extra: Record<string, unknown> = {}) => ({ assesseeId: R_ASSESSEE, amountMinor: "1000", reason: "irrecoverable", ...extra });

  it("400s a new write-off without demandId", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/write-offs", headers: AUTH, payload: body() });
    expect(res.statusCode).toBe(400);
  });
  it("202s a write-off within the demand balance", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/write-offs", headers: AUTH, payload: body({ demandId: R_DEMAND, amountMinor: "500000" }) });
    expect(res.statusCode).toBe(202);
  });
  it("422s an amount above the demand balance", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/write-offs", headers: AUTH, payload: body({ demandId: R_DEMAND, amountMinor: "500001" }) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("WRITEOFF_EXCEEDS_DEMAND_BALANCE");
  });
  it("404s an unknown demand and 422s a demand of another assessee", async () => {
    const unknown = await app.inject({ method: "POST", url: "/v1/revenue/write-offs", headers: AUTH, payload: body({ demandId: randomUUID() }) });
    expect(unknown.statusCode).toBe(404);
    const other = await app.inject({ method: "POST", url: "/v1/revenue/write-offs", headers: AUTH, payload: body({ demandId: R_DEMAND, assesseeId: randomUUID() }) });
    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe("DEMAND_ASSESSEE_MISMATCH");
  });
  it("flags legacy rows as 'legacy, not linked' on list and get; linked rows are not flagged", async () => {
    const one = await app.inject({ method: "GET", url: `/v1/revenue/write-offs/${R_LEGACY}`, headers: AUTH });
    expect(one.json().data.legacyUnlinked).toBe(true);
    const linked = await app.inject({ method: "GET", url: `/v1/revenue/write-offs/${R_LINKED}`, headers: AUTH });
    expect(linked.json().data.legacyUnlinked).toBe(false);
    const list = await app.inject({ method: "GET", url: "/v1/revenue/write-offs", headers: AUTH });
    const flags = list.json().data.map((r: { id: string; legacyUnlinked: boolean }) => [r.id, r.legacyUnlinked]);
    expect(flags).toContainEqual([R_LEGACY, true]);
    expect(flags).toContainEqual([R_LINKED, false]);
  });
});
