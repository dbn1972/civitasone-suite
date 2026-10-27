/**
 * Owner decision #7 (2026-10-26) — GAP-REVENUE-BBPS-01.
 *
 * No live BBPS in UAT: manual pay-bill stays DISABLED by default, and the UI/API
 * only ever pays a bill the server itself issued. fetch-bill issues a
 * single-use, expiring, server-side bill token bound to (tenant, assessee,
 * amount); pay-bill takes ONLY that token + the biller txn id + channel and
 * derives assessee and amount from the token — a typed/invented amount can
 * never be credited.
 *
 * Consumer half: DB-backed, no mocks. Route half: only the repo is mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { bbpsTransactions } from "../src/modules/bbps/schema.js";
import { assessees } from "../src/modules/assessee/schema.js";
import { dcbEntries } from "../src/modules/assessment/schema.js";
import { receipts } from "../src/modules/collection/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerBbpsConsumers } from "../src/modules/bbps/consumer.js";
import { findRequestByMessageId } from "../src/modules/bbps/repo.js";
import { isBbpsManualPayBillEnabled } from "../src/modules/bbps/domain.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "bb070000-0000-4000-8000-00000000bb07";
const ASSESSEE = "bb070000-0000-4000-8000-0000000000ee";
const DEMAND = "bb070000-0000-4000-8000-0000000de111";
const ACTOR = "bb070000-0000-4000-8000-0000000ac707";
const IDENTIFIER = "BBPS-TOKEN-0001";
const OUTSTANDING = 500_000n;

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
const msg = (type: string, messageId: string, payload: Record<string, unknown>) => ({
  messageId, type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
});
async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(bbpsTransactions).where(eq(bbpsTransactions.tenantId, TENANT));
    await tx.delete(receipts).where(eq(receipts.tenantId, TENANT));
    await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, TENANT));
    await tx.delete(assessees).where(eq(assessees.tenantId, TENANT));
  }));
}
async function seed() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(assessees).values({
      id: ASSESSEE, tenantId: TENANT, assesseeType: "property", identifierNo: IDENTIFIER,
      ownerName: "Token Payer", address: "1 Civic Rd", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(dcbEntries).values({
      id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND, entryType: "demand",
      amountMinor: OUTSTANDING, balanceMinor: OUTSTANDING, referenceType: "demand", narration: "fixture", createdBy: ACTOR,
    });
  }));
}
async function start() {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerBbpsConsumers(q);
  await q.start();
  return q;
}
async function fetchBill(q: MemoryQueue) {
  const messageId = randomUUID();
  await q.publish(COMMANDS.bbpsFetchBill, msg(COMMANDS.bbpsFetchBill, messageId, { assesseeIdentifier: IDENTIFIER }));
  await q.drain();
  return findRequestByMessageId(TENANT, messageId);
}
const txns = () => runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(bbpsTransactions).where(eq(bbpsTransactions.tenantId, TENANT))));

beforeAll(clean);
beforeEach(async () => { await clean(); await seed(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("fetch-bill issues a server-side bill token (owner decision #7)", () => {
  it("stores an unguessable, expiring token on the fetch row and exposes it on the request status read", async () => {
    const q = await start();
    const row = await fetchBill(q);
    expect(row).not.toBeNull();
    expect(row!.billToken).toMatch(/^[0-9a-f]{48}$/);
    expect(row!.billExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
    expect(row!.billExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 16 * 60_000);
    expect(row!.billConsumedAt).toBeNull();
    expect(row!.amountMinor).toBe(OUTSTANDING);
    await q.stop();
  });

  it("issues a DIFFERENT token on every fetch", async () => {
    const q = await start();
    const a = await fetchBill(q);
    const b = await fetchBill(q);
    expect(a!.billToken).not.toBe(b!.billToken);
    await q.stop();
  });
});

describe("pay-bill consumer consumes the token exactly once (owner decision #7)", () => {
  const pay = async (q: MemoryQueue, billToken: string, amountMinor = OUTSTANDING.toString()) => {
    const messageId = randomUUID();
    await q.publish(COMMANDS.bbpsPayBill, msg(COMMANDS.bbpsPayBill, messageId, {
      assesseeIdentifier: IDENTIFIER, amountMinor, bbpsTxnId: `TXN-${messageId.slice(0, 8)}`, channel: "online", billToken,
    }));
    await q.drain();
    return findRequestByMessageId(TENANT, messageId);
  };

  it("pays once with a valid token and marks it consumed", async () => {
    const q = await start();
    const bill = (await fetchBill(q))!;
    const paid = await pay(q, bill.billToken!);
    expect(paid!.status).toBe("success");
    const fetchRow = (await txns()).find((t) => t.id === bill.id)!;
    expect(fetchRow.billConsumedAt).toBeInstanceOf(Date);
    await q.stop();
  });

  it("refuses a second payment with the same token (replay) — one receipt only", async () => {
    const q = await start();
    const bill = (await fetchBill(q))!;
    expect((await pay(q, bill.billToken!))!.status).toBe("success");
    const second = await pay(q, bill.billToken!, "1000");
    expect(second!.status).toBe("failed");
    expect(second!.failureReason).toMatch(/token/i);
    const rc = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(receipts).where(eq(receipts.tenantId, TENANT))));
    expect(rc).toHaveLength(1);
    await q.stop();
  });

  it("refuses an unknown token and an expired token", async () => {
    const q = await start();
    const bill = (await fetchBill(q))!;
    expect((await pay(q, "0".repeat(48)))!.status).toBe("failed");
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.update(bbpsTransactions).set({ billExpiresAt: new Date(Date.now() - 1000) }).where(eq(bbpsTransactions.id, bill.id));
    }));
    const expired = await pay(q, bill.billToken!);
    expect(expired!.status).toBe("failed");
    const rc = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(receipts).where(eq(receipts.tenantId, TENANT))));
    expect(rc).toHaveLength(0);
    await q.stop();
  });
});

describe("manual pay-bill gate (owner decision #7: stays disabled in UAT)", () => {
  it("is off by default and never on in production, whatever the flag says", () => {
    expect(isBbpsManualPayBillEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isBbpsManualPayBillEnabled({ BBPS_MANUAL_PAYBILL_ENABLED: "true", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

// ── Route half ───────────────────────────────────────────────────────────────
// The JWT signing secret is injected by vitest.config.ts (test.env.JWT_SECRET).
const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const R_TENANT = "f1111111-1111-4111-8111-111111111117";
const R_USER = "f2222222-2222-4222-8222-222222222227";
const AUTH = { authorization: `Bearer ${signToken({ sub: R_USER, tid: R_TENANT, roles: ["revenue_admin"], sid: "s1" }, SECRET, 3600)}` };
const publishSpy = vi.fn().mockResolvedValue(undefined);
const GOOD = "a".repeat(48), USED = "b".repeat(48), OLD = "c".repeat(48);

vi.mock("../src/modules/bbps/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/bbps/repo.js")>();
  const future = new Date(Date.now() + 600_000), past = new Date(Date.now() - 600_000);
  const bills: Record<string, unknown> = {
    ["a".repeat(48)]: { identifierNo: "PROP-9", amountMinor: 250_000n, billExpiresAt: future, billConsumedAt: null },
    ["b".repeat(48)]: { identifierNo: "PROP-9", amountMinor: 250_000n, billExpiresAt: future, billConsumedAt: new Date() },
    ["c".repeat(48)]: { identifierNo: "PROP-9", amountMinor: 250_000n, billExpiresAt: past, billConsumedAt: null },
  };
  return { ...original, findBillByToken: vi.fn(async (_t: string, token: string) => bills[token] ?? null) };
});
vi.mock("../src/shared/infra.js", () => ({
  cache: { put: vi.fn(), get: vi.fn().mockResolvedValue(null), getOrLoad: vi.fn().mockResolvedValue([]), invalidate: vi.fn() },
  queue: {
    publish: (...a: unknown[]) => publishSpy(...a), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

describe("POST /v1/revenue/bbps/pay-bill takes only a server-issued token (owner decision #7)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { process.env.BBPS_ENABLED = "true"; process.env.BBPS_MANUAL_PAYBILL_ENABLED = "true"; publishSpy.mockClear(); });
  afterEach(() => { delete process.env.BBPS_ENABLED; delete process.env.BBPS_MANUAL_PAYBILL_ENABLED; });

  const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/revenue/bbps/pay-bill", headers: AUTH, payload });

  it("stays 403 BBPS_PAYBILL_DISABLED without the explicit opt-in, publishing nothing", async () => {
    delete process.env.BBPS_MANUAL_PAYBILL_ENABLED;
    const res = await post({ billToken: GOOD, bbpsTxnId: "T1", channel: "online" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("BBPS_PAYBILL_DISABLED");
    expect(publishSpy).not.toHaveBeenCalled();
  });
  it("400s a free-typed payment with no token", async () => {
    const res = await post({ assesseeIdentifier: "PROP-9", amountMinor: "999999", bbpsTxnId: "T1", channel: "online" });
    expect(res.statusCode).toBe(400);
    expect(publishSpy).not.toHaveBeenCalled();
  });
  it("derives assessee and amount from the token, ignoring any typed values", async () => {
    const res = await post({ billToken: GOOD, bbpsTxnId: "T1", channel: "online", amountMinor: "999999999", assesseeIdentifier: "OTHER" });
    expect(res.statusCode).toBe(202);
    const published = publishSpy.mock.calls.at(-1)![1] as { payload: Record<string, unknown> };
    expect(published.payload.amountMinor).toBe("250000");
    expect(published.payload.assesseeIdentifier).toBe("PROP-9");
    expect(published.payload.billToken).toBe(GOOD);
  });
  it("rejects unknown (404), already-used (409) and expired (410) tokens", async () => {
    expect((await post({ billToken: "d".repeat(48), bbpsTxnId: "T1", channel: "online" })).statusCode).toBe(404);
    expect((await post({ billToken: USED, bbpsTxnId: "T1", channel: "online" })).statusCode).toBe(409);
    expect((await post({ billToken: OLD, bbpsTxnId: "T1", channel: "online" })).statusCode).toBe(410);
    expect(publishSpy).not.toHaveBeenCalled();
  });
});
