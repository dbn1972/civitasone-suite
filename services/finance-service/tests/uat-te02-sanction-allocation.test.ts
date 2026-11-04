/**
 * UAT T-EDGE TE-02 (bundle 19), real Postgres: a sanction must fit what the head allocation still has available
 * (allocation - approved sanctions - committed - expended) on create AND approve, under a row lock, so parallel
 * approvals serialise: exactly one wins, the other is 422 BUDGET_EXCEEDED with the available amount.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { financeHeads, financeBudgets, financeSanctions } from "../src/modules/budget/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { currentFyIST } from "../src/shared/ist-date.js";
import { COMMANDS } from "../src/topics.js";
import * as budgetRepo from "../src/modules/budget/repo.js";

// the HS256 test signing key comes from vitest.config.ts (env JWT_SECRET); no key literal in this file
const SECRET = process.env.JWT_SECRET as string;
const T = randomUUID();
const MAKER = "00000000-aaaa-4000-8000-0000000e0201";
const CHECK_B = "00000000-aaaa-4000-8000-0000000e0202";
const CHECK_C = "00000000-aaaa-4000-8000-0000000e0203";
const FY = currentFyIST();
const H = { edu: randomUUID(), med: randomUUID() };
const as = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: T, roles, sid: `s-${sub.slice(-3)}` }, SECRET)}` });
type Sent = { topic: string; env: Record<string, unknown> };
let sent: Sent[] = [];
let app: Awaited<ReturnType<typeof buildApp>>;

let lastDlq: unknown[] = [];
async function deliver(): Promise<void> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  registerBudgetConsumers(q);
  await q.start();
  const batch = sent; sent = [];
  for (const b of batch) await q.publish(b.topic, b.env as never);
  await q.drain();
  lastDlq = [...q.dlq];
  await q.stop();
}
async function createSanction(headId: string, amountMinor: number) {
  const res = await app.inject({ method: "POST", url: "/v1/finance/sanctions", headers: as(MAKER, ["finance_officer"]),
    payload: { sanctionNo: `TE02-${randomUUID().slice(0, 8)}`, purpose: "TE-02 allocation check", headId, amountMinor } });
  if (res.statusCode === 202) await deliver();
  return res;
}
const approve = (id: string, by: string) => app.inject({ method: "PATCH", url: `/v1/finance/sanctions/${id}/approve`, headers: as(by, ["finance_admin"]), payload: {} });
const status = async (id: string) => (await scoped(T, (tx) => tx.select().from(financeSanctions).where(and(eq(financeSanctions.tenantId, T), eq(financeSanctions.id, id)))))[0]?.status;

beforeAll(async () => {
  vi.spyOn(queue, "publish").mockImplementation((async (topic: string, env: Sent["env"]) => { sent.push({ topic, env }); }) as never);
  app = await buildApp();
  await scoped(T, async (tx) => {
    await tx.insert(financeHeads).values([
      { id: H.edu, tenantId: T, code: "2202", name: "General Education", level: 1, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
      { id: H.med, tenantId: T, code: "2210", name: "Medical", level: 1, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
    ]);
    // Rs 1.5 lakh allocated on 2202 (the UT3E2192 case), Rs 5,000 on 2210
    await tx.insert(financeBudgets).values([
      { tenantId: T, headId: H.edu, fy: FY, beMinor: 15000000n, reMinor: 15000000n, createdBy: MAKER, updatedBy: MAKER },
      { tenantId: T, headId: H.med, fy: FY, beMinor: 500000n, reMinor: 500000n, createdBy: MAKER, updatedBy: MAKER },
    ]);
    await tx.insert(financeBudgetAllocation).values([
      { tenantId: T, headId: H.edu, fy: FY, allocatedMinor: 15000000n, createdBy: MAKER, updatedBy: MAKER },
      { tenantId: T, headId: H.med, fy: FY, allocatedMinor: 500000n, createdBy: MAKER, updatedBy: MAKER },
    ]);
  });
});
afterAll(async () => { vi.restoreAllMocks(); await app.close(); await sqlClient.end(); });

describe("TE-02: sanctions are checked against the head allocation", () => {
  it("a single sanction above the allocation is refused at create (422 BUDGET_EXCEEDED with the available amount)", async () => {
    const res = await createSanction(H.edu, 20000000);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("BUDGET_EXCEEDED");
    expect(JSON.stringify(res.json())).toContain("150000.00");
  });
  it("two Rs 1 lakh sanctions approved in parallel on a Rs 1.5 lakh allocation: exactly one wins, the other gets 422", async () => {
    const a = await createSanction(H.edu, 10000000);
    const b = await createSanction(H.edu, 10000000);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    const [ida, idb] = [a.json().id as string, b.json().id as string];
    expect([await status(ida), await status(idb)]).toEqual(["pending_approval", "pending_approval"]);
    const results = await Promise.all([approve(ida, CHECK_B), approve(idb, CHECK_C)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([202, 422]);
    const loser = results.find((r) => r.statusCode === 422)!;
    expect(loser.json().code).toBe("BUDGET_EXCEEDED");
    expect(JSON.stringify(loser.json())).toContain("50000.00");
    expect([await status(ida), await status(idb)].sort()).toEqual(["approved", "pending_approval"]);
    // and a new sanction larger than the Rs 50,000 still available is refused at create
    expect((await createSanction(H.edu, 6000000)).statusCode).toBe(422);
  });
  it("a sanction exactly at the available amount is allowed", async () => {
    const s = await createSanction(H.med, 500000);
    expect(s.statusCode).toBe(202);
    const id = s.json().id as string;
    expect((await approve(id, CHECK_B)).statusCode).toBe(202);
    expect(await status(id)).toBe("approved");
    // nothing left: one more paisa is refused
    expect((await createSanction(H.med, 1)).statusCode).toBe(422);
  });
});

describe("#2464 review: sanctioned money cannot be re-appropriated away", () => {
  // after the tests above: 2202 has a Rs 1.5 lakh allocation and Rs 1 lakh approved; 2210 Rs 5,000 allocated, all sanctioned
  const alloc = async (headId: string) => (await scoped(T, (tx) => tx.select().from(financeBudgetAllocation).where(and(eq(financeBudgetAllocation.tenantId, T), eq(financeBudgetAllocation.headId, headId), eq(financeBudgetAllocation.fy, FY)))))[0]!;
  const reappropriate = (amountMinor: number) => sent.push({ topic: COMMANDS.budgetAllocationReappropriate, env: {
    messageId: randomUUID(), type: COMMANDS.budgetAllocationReappropriate, tenantId: T, actorId: CHECK_B, correlationId: "te02-reapp", schemaVersion: "1.0",
    payload: { id: randomUUID(), tenantId: T, fy: FY, fromHeadId: H.edu, toHeadId: H.med, amountMinor, reason: "TE-02 guard", toAllocId: randomUUID(), logId: randomUUID() } } });
  it("an allocation re-appropriation may not take the sanctioned part: Rs 60,000 of Rs 50,000 free is refused, Rs 50,000 moves", async () => {
    reappropriate(6000000);
    await deliver();
    expect(lastDlq).toHaveLength(1);
    expect((await alloc(H.edu)).allocatedMinor).toBe(15000000n);
    reappropriate(5000000);
    await deliver();
    expect(lastDlq).toHaveLength(0);
    expect((await alloc(H.edu)).allocatedMinor).toBe(10000000n);
    expect((await alloc(H.med)).allocatedMinor).toBe(5500000n);
  });
  it("an allocation may not be reduced below its approved sanctions", async () => {
    sent.push({ topic: COMMANDS.budgetAllocationUpsert, env: { messageId: randomUUID(), type: COMMANDS.budgetAllocationUpsert, tenantId: T, actorId: CHECK_B, correlationId: "te02-upsert", schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: T, headId: H.edu, fy: FY, allocatedMinor: 9999999 } } });
    await deliver();
    expect(lastDlq).toHaveLength(1);
    expect((await alloc(H.edu)).allocatedMinor).toBe(10000000n);
  });
  it("a budget (RE) re-appropriation leaves room for the approved sanctions too", async () => {
    const budgetOf = async (headId: string) => (await scoped(T, (tx) => tx.select().from(financeBudgets).where(and(eq(financeBudgets.tenantId, T), eq(financeBudgets.headId, headId), eq(financeBudgets.fy, FY)))))[0]!;
    const edu = await budgetOf(H.edu); const med = await budgetOf(H.med);
    // RE Rs 1.5 lakh, Rs 1 lakh sanctioned: Rs 50,000 is free
    expect(await scoped(T, (tx) => budgetRepo.transferBudgetReMinorGuarded(tx, edu.id, med.id, 5000001n, T, CHECK_B))).toBe(false);
    expect(await scoped(T, (tx) => budgetRepo.transferBudgetReMinorGuarded(tx, edu.id, med.id, 5000000n, T, CHECK_B))).toBe(true);
    expect((await budgetOf(H.edu)).reMinor).toBe(10000000n);
  });
});
