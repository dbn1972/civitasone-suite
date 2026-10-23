/**
 * Waiver ledger + list, bill duplicate guard (real DB, no mocks of db/consumers/routes).
 *
 *  1. waiverCreate persists waiverType (penalty | interest | both)
 *  2. waiverDecide approve appends ONE balance-reducing `waiver` DCB entry on the
 *     waiver's demand (once only); reject writes nothing
 *  3. GET /v1/revenue/waivers is tenant-scoped, status-filterable, paginated and
 *     role-gated
 *  4. POST /v1/revenue/bills/generate answers 409 synchronously when the
 *     assessment already has a bill
 *  5. GET /assessees/:id/dcb exposes the service's outstanding figure and
 *     classifies refunds / adjustments by entry type
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { waivers } from "../src/modules/trade-license/schema.js";
import { dcbEntries, demands } from "../src/modules/assessment/schema.js";
import { bills } from "../src/modules/billing/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dec20000-0000-4000-8000-00000000de01";
const OTHER_TENANT = "dec20000-0000-4000-8000-00000000de02";
const ASSESSEE = "dec20000-0000-4000-8000-0000000000ae";
const DEMAND = "dec20000-0000-4000-8000-00000000de11";
const ASSESSMENT = "dec20000-0000-4000-8000-0000000a5e55";
const MAKER = "dec20000-0000-4000-8000-00000000a001";
const CHECKER = "dec20000-0000-4000-8000-0000000c0ec1";
const OUTSTANDING = 100_000n;

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(type: string, actorId: string, payload: Record<string, unknown>, tenantId = TENANT) {
  return {
    messageId: randomUUID(),
    type,
    tenantId,
    actorId,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  };
}

const inTenant = <T>(fn: (tx: typeof db) => Promise<T>, tenant = TENANT) =>
  runWithTenant(tenant, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

async function clean() {
  for (const t of [TENANT, OTHER_TENANT]) {
    await inTenant(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(waivers).where(eq(waivers.tenantId, t));
      await tx.delete(bills).where(eq(bills.tenantId, t));
      await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, t));
      await tx.delete(demands).where(eq(demands.tenantId, t));
    }, t);
  }
}

async function seedDemand() {
  await inTenant(async (tx) => {
    await tx.insert(demands).values({
      id: DEMAND, tenantId: TENANT, assesseeId: ASSESSEE, assessmentId: ASSESSMENT,
      rateHeadId: randomUUID(), financialYear: "2025-2026", dueDate: "2026-03-31",
      principalMinor: 80_000n, penaltyMinor: 12_000n, interestMinor: 8_000n, netMinor: OUTSTANDING,
      computeSnapshot: {}, createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(dcbEntries).values({
      tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND,
      entryType: "demand", amountMinor: OUTSTANDING, balanceMinor: OUTSTANDING,
      referenceType: "demand", narration: "waiver fixture", createdBy: MAKER,
    });
  });
}

async function seedWaiver(over: Partial<typeof waivers.$inferInsert> = {}, tenant = TENANT): Promise<string> {
  return inTenant(async (tx) => {
    const [row] = await tx.insert(waivers).values({
      tenantId: tenant, demandId: DEMAND, amountMinor: 5_000n, reason: "Hardship",
      status: "pending", requestedBy: MAKER, ...over,
    }).returning({ id: waivers.id });
    return row!.id;
  }, tenant);
}

const entries = (type: string) =>
  inTenant((tx) => tx.select().from(dcbEntries).where(eq(dcbEntries.tenantId, TENANT)))
    .then((rows) => rows.filter((r) => r.entryType === type));
const waiverRow = (id: string) =>
  inTenant((tx) => tx.select().from(waivers).where(eq(waivers.id, id))).then((r) => r[0]!);

async function startConsumers(): Promise<MemoryQueue> {
  const q = wireTenantAwareQueue(new MemoryQueue()) as MemoryQueue;
  registerArrearsConsumers(q);
  await q.start();
  return q;
}

beforeAll(clean);
beforeEach(async () => {
  await clean();
  await seedDemand();
});
afterAll(async () => {
  await clean();
  await sqlClient.end();
});

describe("waiver create persists waiverType (real DB)", () => {
  it.each(["penalty", "interest", "both"] as const)("stores waiverType=%s", async (waiverType) => {
    const q = await startConsumers();
    await q.publish(COMMANDS.waiverCreate, makeMsg(COMMANDS.waiverCreate, MAKER, {
      demandId: DEMAND, amountMinor: "1000", reason: "Hardship", waiverType,
    }));
    await q.drain();
    const rows = await inTenant((tx) => tx.select().from(waivers).where(eq(waivers.tenantId, TENANT)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.waiverType).toBe(waiverType);
    await q.stop();
  });

  it("defaults to 'both' when the request carries no waiverType", async () => {
    const q = await startConsumers();
    await q.publish(COMMANDS.waiverCreate, makeMsg(COMMANDS.waiverCreate, MAKER, {
      demandId: DEMAND, amountMinor: "1000", reason: "Hardship",
    }));
    await q.drain();
    const rows = await inTenant((tx) => tx.select().from(waivers).where(eq(waivers.tenantId, TENANT)));
    expect(rows[0]!.waiverType).toBe("both");
    await q.stop();
  });
});

describe("waiver decide writes the ledger (real DB)", () => {
  it("approve appends ONE balance-reducing waiver entry on the demand, once only", async () => {
    const id = await seedWaiver({ amountMinor: 5_000n, waiverType: "penalty" });
    const q = await startConsumers();
    await q.publish(COMMANDS.waiverDecide, makeMsg(COMMANDS.waiverDecide, CHECKER, { waiverId: id, approve: true }));
    await q.drain();
    // A second approve of the same waiver must not post again.
    await q.publish(COMMANDS.waiverDecide, makeMsg(COMMANDS.waiverDecide, CHECKER, { waiverId: id, approve: true }));
    await q.drain();

    const rows = await entries("waiver");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.demandId).toBe(DEMAND);
    expect(rows[0]!.assesseeId).toBe(ASSESSEE);
    expect(rows[0]!.amountMinor).toBe(5_000n);
    expect(rows[0]!.balanceMinor).toBe(OUTSTANDING - 5_000n);
    expect(rows[0]!.referenceId).toBe(id);
    expect((await waiverRow(id)).status).toBe("approved");
    await q.stop();
  });

  it("reject writes no ledger entry", async () => {
    const id = await seedWaiver();
    const q = await startConsumers();
    await q.publish(COMMANDS.waiverDecide, makeMsg(COMMANDS.waiverDecide, CHECKER, { waiverId: id, approve: false }));
    await q.drain();
    expect(await entries("waiver")).toHaveLength(0);
    expect((await waiverRow(id)).status).toBe("rejected");
    await q.stop();
  });

  it("the maker cannot approve their own waiver (no ledger entry)", async () => {
    const id = await seedWaiver();
    const q = await startConsumers();
    await q.publish(COMMANDS.waiverDecide, makeMsg(COMMANDS.waiverDecide, MAKER, { waiverId: id, approve: true }));
    await q.drain();
    expect(await entries("waiver")).toHaveLength(0);
    expect((await waiverRow(id)).status).toBe("pending");
    await q.stop();
  });
});

describe("routes (real DB)", () => {
  let app: FastifyInstance;
  const headersFor = (tenant: string, roles: string[]) => ({
    authorization: `Bearer ${signToken({ sub: CHECKER, tid: tenant, roles, sid: "s1" }, SECRET, 3600)}`,
  });
  const AUTH = headersFor(TENANT, ["revenue_admin"]);

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  describe("GET /v1/revenue/waivers", () => {
    it("lists this tenant's waivers only, newest first, with pagination meta", async () => {
      const a = await seedWaiver({ amountMinor: 1_000n });
      const b = await seedWaiver({ amountMinor: 2_000n });
      await seedWaiver({ amountMinor: 9_000n }, OTHER_TENANT);

      const res = await app.inject({ method: "GET", url: "/v1/revenue/waivers", headers: AUTH });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.meta).toMatchObject({ page: 1, pageSize: 50, total: 2 });
      expect(body.data.map((w: { id: string }) => w.id).sort()).toEqual([a, b].sort());
      expect(body.data.every((w: { tenantId: string }) => w.tenantId === TENANT)).toBe(true);
    });

    it("filters by status and paginates", async () => {
      await seedWaiver({ status: "pending" });
      await seedWaiver({ status: "pending" });
      await seedWaiver({ status: "approved" });

      const pending = await app.inject({ method: "GET", url: "/v1/revenue/waivers?status=pending", headers: AUTH });
      expect(pending.json().meta.total).toBe(2);
      expect(pending.json().data.every((w: { status: string }) => w.status === "pending")).toBe(true);

      const page2 = await app.inject({ method: "GET", url: "/v1/revenue/waivers?limit=1&offset=1", headers: AUTH });
      expect(page2.json().data).toHaveLength(1);
      expect(page2.json().meta).toMatchObject({ page: 2, pageSize: 1, total: 3 });
    });

    it("rejects an unknown status with 400, an unauthenticated call with 401 and a non-revenue role with 403", async () => {
      expect((await app.inject({ method: "GET", url: "/v1/revenue/waivers?status=bogus", headers: AUTH })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/v1/revenue/waivers" })).statusCode).toBe(401);
      expect(
        (await app.inject({ method: "GET", url: "/v1/revenue/waivers", headers: headersFor(TENANT, ["employee"]) })).statusCode,
      ).toBe(403);
    });

    it("does not shadow GET /waivers/:id", async () => {
      const id = await seedWaiver();
      const res = await app.inject({ method: "GET", url: `/v1/revenue/waivers/${id}`, headers: AUTH });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(id);
    });
  });

  describe("POST /v1/revenue/bills/generate duplicate guard", () => {
    const seedBill = (tenant = TENANT) =>
      inTenant(async (tx) => {
        await tx.insert(bills).values({
          tenantId: tenant, assesseeId: ASSESSEE, demandId: DEMAND, assessmentId: ASSESSMENT,
          billNo: "BILL-DUP-0001", billDate: "2026-04-01", dueDate: "2026-04-30",
          principalMinor: 80_000n, totalMinor: 80_000n, receiptHeadCode: "PT", createdBy: MAKER, updatedBy: MAKER,
        });
      }, tenant);

    it("202 when no bill exists for the assessment", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/revenue/bills/generate", headers: AUTH, payload: { assessmentId: ASSESSMENT },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().data.messageId).toBeTruthy();
    });

    it("409 BILL_ALREADY_EXISTS when the assessment already has a bill", async () => {
      await seedBill();
      const res = await app.inject({
        method: "POST", url: "/v1/revenue/bills/generate", headers: AUTH, payload: { assessmentId: ASSESSMENT },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("BILL_ALREADY_EXISTS");
    });

    it("another tenant's bill for the same assessment id does not block this tenant", async () => {
      await seedBill(OTHER_TENANT);
      const res = await app.inject({
        method: "POST", url: "/v1/revenue/bills/generate", headers: AUTH, payload: { assessmentId: ASSESSMENT },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("GET /assessees/:id/dcb", () => {
    it("classifies refund / waiver / adjustment legs and exposes the service outstanding", async () => {
      await inTenant(async (tx) => {
        const base = { tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND, createdBy: MAKER, referenceType: "t" };
        const t0 = Date.now();
        const rows: Array<[string, bigint, bigint, string | null]> = [
          ["collection", 40_000n, 60_000n, null],
          ["refund", 10_000n, 70_000n, null],
          ["waiver", 5_000n, 65_000n, null],
          ["adjustment", 15_000n, 50_000n, "Adjustment debit: move"],
        ];
        let i = 1;
        for (const [entryType, amountMinor, balanceMinor, narration] of rows) {
          await tx.insert(dcbEntries).values({
            ...base, entryType, amountMinor, balanceMinor, narration,
            createdAt: new Date(t0 + i++ * 1000),
          });
        }
      });
      const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE}/dcb`, headers: AUTH });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({
        totalDemand: "100000",
        // 40000 - 10000 (refund raises) + 5000 + 15000 (debit leg)
        totalCollected: "50000",
        balance: "50000",
        // latest running balance of the demand — the figure the instalment consumer plans against
        outstandingMinor: "50000",
      });
    });
  });
});
