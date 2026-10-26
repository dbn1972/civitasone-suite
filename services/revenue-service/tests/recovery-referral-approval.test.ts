/**
 * Owner decision #4 (2026-10-26) — GAP-REVENUE-RECOVERY-01.
 *
 * A coercive recovery referral is maker-checker and is allowed ONLY after the
 * demand notice has been served and its notice period has lapsed:
 *   - no notice served                  -> refused (nothing written)
 *   - notice served, period not lapsed  -> refused (nothing written)
 *   - notice period lapsed              -> a PENDING referral; legal-service is
 *                                          NOT told until a DIFFERENT officer approves
 *   - maker approving own referral      -> refused in the consumer
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
import { recoveryReferrals, demandNotices } from "../src/modules/arrears/schema.js";
import { dcbEntries } from "../src/modules/assessment/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "ad040000-0000-4000-8000-00000000ad40";
const OWING = "ad040000-0000-4000-8000-0000000000e1";
const NO_NOTICE = "ad040000-0000-4000-8000-0000000000e2";
const FRESH = "ad040000-0000-4000-8000-0000000000e3";
const D_OWING = "ad040000-0000-4000-8000-0000000de001";
const D_NO_NOTICE = "ad040000-0000-4000-8000-0000000de002";
const D_FRESH = "ad040000-0000-4000-8000-0000000de003";
const MAKER = "ad040000-0000-4000-8000-00000000a000";
const CHECKER = "ad040000-0000-4000-8000-0000000c0ec0";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

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
    await tx.delete(recoveryReferrals).where(eq(recoveryReferrals.tenantId, TENANT));
    await tx.delete(demandNotices).where(eq(demandNotices.tenantId, TENANT));
    await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, TENANT));
  }));
}
async function seed() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    for (const [assessee, demand] of [[OWING, D_OWING], [NO_NOTICE, D_NO_NOTICE], [FRESH, D_FRESH]] as const) {
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: assessee, demandId: demand, entryType: "demand",
        amountMinor: 500_000n, balanceMinor: 500_000n, referenceType: "demand", narration: "fixture", createdBy: MAKER,
      });
    }
    // OWING: notice served 40 days ago with a 30-day period -> lapsed 10 days ago.
    await tx.insert(demandNotices).values({ tenantId: TENANT, assesseeId: OWING, noticeNo: "DN-OWING-1", servedOn: daysAgo(40), noticePeriodDays: 30, servedBy: MAKER });
    // FRESH: notice served today with a 30-day period -> not lapsed.
    await tx.insert(demandNotices).values({ tenantId: TENANT, assesseeId: FRESH, noticeNo: "DN-FRESH-1", servedOn: daysAgo(0), noticePeriodDays: 30, servedBy: MAKER });
  }));
}
async function start() {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerArrearsConsumers(q);
  await q.start();
  return q;
}
async function refer(q: MemoryQueue, assesseeId: string) {
  await q.publish(COMMANDS.recoveryRefer, msg(COMMANDS.recoveryRefer, MAKER, { assesseeId, reason: "chronic default" }));
  await q.drain();
}
const referrals = () => runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(recoveryReferrals).where(eq(recoveryReferrals.tenantId, TENANT))));
const outbox = (eventType: string) => runWithTenant(TENANT, () => db.transaction((tx) =>
  tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, eventType)))));

beforeAll(clean);
beforeEach(async () => { await clean(); await seed(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("recovery referral needs a served, lapsed demand notice (owner decision #4)", () => {
  it("refuses a referral when NO demand notice has been served, writing nothing", async () => {
    const q = await start();
    await refer(q, NO_NOTICE);
    expect(await referrals()).toHaveLength(0);
    expect(q.dlq.length).toBeGreaterThan(0);
    await q.stop();
  });

  it("refuses a referral while the notice period has NOT lapsed", async () => {
    const q = await start();
    await refer(q, FRESH);
    expect(await referrals()).toHaveLength(0);
    expect(q.dlq.length).toBeGreaterThan(0);
    await q.stop();
  });

  it("records a PENDING referral (with the notice it relied on) once the period has lapsed — and does NOT notify legal yet", async () => {
    const q = await start();
    await refer(q, OWING);
    const r = await referrals();
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("pending");
    expect(r[0]!.noticeId).toBeTruthy();
    expect(r[0]!.createdBy).toBe(MAKER);
    expect(await outbox(EVENTS.recoveryReferred)).toHaveLength(0);
    await q.stop();
  });
});

describe("recovery referral maker-checker (owner decision #4)", () => {
  it("the maker cannot decide their own referral; it stays pending and legal is not notified", async () => {
    const q = await start();
    await refer(q, OWING);
    const [r] = await referrals();
    await q.publish(COMMANDS.recoveryReferDecide, msg(COMMANDS.recoveryReferDecide, MAKER, { referralId: r!.id, approve: true }));
    await q.drain();
    expect(q.dlq.length).toBeGreaterThan(0);
    expect((await referrals())[0]!.status).toBe("pending");
    expect(await outbox(EVENTS.recoveryReferred)).toHaveLength(0);
    await q.stop();
  });

  it("a DIFFERENT officer approves: referral becomes 'referred', legal is notified exactly once, decision audited", async () => {
    const q = await start();
    await refer(q, OWING);
    const [r] = await referrals();
    await q.publish(COMMANDS.recoveryReferDecide, msg(COMMANDS.recoveryReferDecide, CHECKER, { referralId: r!.id, approve: true, reason: "notice lapsed, dues unpaid" }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    const row = (await referrals())[0]!;
    expect(row.status).toBe("referred");
    expect(row.checkerUserId).toBe(CHECKER);
    expect(row.decidedAt).toBeInstanceOf(Date);
    const events = await outbox(EVENTS.recoveryReferred);
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as Record<string, unknown>).assesseeId).toBe(OWING);
    const decide = (await outbox("audit.event.record")).map((a) => a.payload as Record<string, unknown>).find((p) => p.action === "decide");
    expect(decide).toMatchObject({ resourceType: "recovery_referral", outcome: "approved", resourceId: r!.id });
    await q.stop();
  });

  it("a reject leaves it 'rejected' and legal is never notified", async () => {
    const q = await start();
    await refer(q, OWING);
    const [r] = await referrals();
    await q.publish(COMMANDS.recoveryReferDecide, msg(COMMANDS.recoveryReferDecide, CHECKER, { referralId: r!.id, approve: false, reason: "paid under protest" }));
    await q.drain();
    expect((await referrals())[0]!.status).toBe("rejected");
    expect(await outbox(EVENTS.recoveryReferred)).toHaveLength(0);
    await q.stop();
  });

  it("approval re-checks eligibility: if the dues were cleared meanwhile it is NOT referred (stays pending, audited)", async () => {
    const q = await start();
    await refer(q, OWING);
    const [r] = await referrals();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: OWING, demandId: D_OWING, entryType: "collection",
        amountMinor: 500_000n, balanceMinor: 0n, referenceType: "receipt", narration: "paid", createdBy: MAKER,
        createdAt: new Date(Date.now() + 5_000),
      });
    }));
    await q.publish(COMMANDS.recoveryReferDecide, msg(COMMANDS.recoveryReferDecide, CHECKER, { referralId: r!.id, approve: true }));
    await q.drain();
    expect((await referrals())[0]!.status).toBe("pending");
    expect(await outbox(EVENTS.recoveryReferred)).toHaveLength(0);
    const audit = (await outbox("audit.event.record")).map((a) => a.payload as Record<string, unknown>).find((p) => p.outcome === "no_longer_eligible");
    expect(audit).toBeDefined();
    await q.stop();
  });
});

describe("serving a demand notice (owner decision #4)", () => {
  it("records the notice with its served date and notice period, and audits it", async () => {
    const q = await start();
    await q.publish(COMMANDS.demandNoticeServe, msg(COMMANDS.demandNoticeServe, MAKER, {
      assesseeId: NO_NOTICE, noticeNo: "DN-NEW-1", servedOn: daysAgo(2), noticePeriodDays: 15,
    }));
    await q.drain();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(demandNotices).where(and(eq(demandNotices.tenantId, TENANT), eq(demandNotices.assesseeId, NO_NOTICE)))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.noticePeriodDays).toBe(15);
    expect(rows[0]!.servedBy).toBe(MAKER);
    const audit = (await outbox("audit.event.record")).map((a) => a.payload as Record<string, unknown>).find((p) => p.resourceType === "demand_notice");
    expect(audit).toMatchObject({ action: "serve", outcome: "success" });
    await q.stop();
  });

  it("refuses a notice dated in the future (it cannot have been served yet)", async () => {
    const q = await start();
    await q.publish(COMMANDS.demandNoticeServe, msg(COMMANDS.demandNoticeServe, MAKER, {
      assesseeId: NO_NOTICE, noticeNo: "DN-FUT", servedOn: daysAgo(-5), noticePeriodDays: 15,
    }));
    await q.drain();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(demandNotices).where(and(eq(demandNotices.tenantId, TENANT), eq(demandNotices.assesseeId, NO_NOTICE)))));
    expect(rows).toHaveLength(0);
    await q.stop();
  });
});

// ── Route half ───────────────────────────────────────────────────────────────
const R_TENANT = "f1111111-1111-4111-8111-111111111114";
const R_MAKER = "f2222222-2222-4222-8222-222222222224";
const R_OTHER = "f3333333-3333-4333-8333-333333333334";
const R_PENDING = "f4444444-4444-4444-8444-444444444444";
const R_DONE = "f5555555-5555-4555-8555-555555555554";
const R_ASSESSEE = "f6666666-6666-4666-8666-666666666664";
const SECRET = "test_secret_for_civitasone_32chr";
const tok = (sub: string, roles = ["revenue_admin"]) => ({ authorization: `Bearer ${signToken({ sub, tid: R_TENANT, roles, sid: "s1" }, SECRET, 3600)}` });
const publishSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/modules/arrears/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/arrears/repo.js")>();
  const rows: Record<string, Record<string, unknown>> = {
    "f4444444-4444-4444-8444-444444444444": { id: "f4444444-4444-4444-8444-444444444444", tenantId: "f1111111-1111-4111-8111-111111111114", status: "pending", createdBy: "f2222222-2222-4222-8222-222222222224", assesseeId: "f6666666-6666-4666-8666-666666666664" },
    "f5555555-5555-4555-8555-555555555554": { id: "f5555555-5555-4555-8555-555555555554", tenantId: "f1111111-1111-4111-8111-111111111114", status: "referred", createdBy: "f2222222-2222-4222-8222-222222222224", assesseeId: "f6666666-6666-4666-8666-666666666664" },
  };
  return {
    ...original,
    findRecoveryReferralById: vi.fn(async (t: string, id: string) => (rows[id] && rows[id]!.tenantId === t ? rows[id]! : null)),
    listRecoveryReferrals: vi.fn(async (t: string, _p: unknown, _a?: string, status?: string) => {
      const r = Object.values(rows).filter((x) => x.tenantId === t && (!status || x.status === status));
      return { rows: r, total: r.length };
    }),
    precheckDemandNotice: vi.fn(async (_t: string, i: { assesseeId: string; demandId?: string; noticeNo: string }) => ({
      assesseeExists: i.assesseeId === "f6666666-6666-4666-8666-666666666664",
      noticeExists: i.noticeNo === "DN-DUP",
      demandAssesseeId: i.demandId === "f7777777-7777-4777-8777-777777777777" ? "f6666666-6666-4666-8666-666666666664"
        : i.demandId === "f8888888-8888-4888-8888-888888888888" ? "f9999999-9999-4999-8999-999999999990" : i.demandId ? null : undefined,
    })),
    getRecoveryReadiness: vi.fn(async () => ({
      outstandingMinor: 500_000n,
      notices: [{ id: "n1", noticeNo: "DN-1", servedOn: "2026-08-01", noticePeriodDays: 30, lapsesOn: "2026-08-31", lapsed: true }],
      eligible: true,
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

describe("recovery referral + demand notice routes (owner decision #4)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  const decide = (id: string, headers: Record<string, string>, payload: Record<string, unknown> = { approve: true }) =>
    app.inject({ method: "PATCH", url: `/v1/revenue/recovery-referrals/${id}/decide`, headers, payload });

  it("decide: 409 MAKER_CHECKER_VIOLATION for the maker, nothing published", async () => {
    publishSpy.mockClear();
    const res = await decide(R_PENDING, tok(R_MAKER));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MAKER_CHECKER_VIOLATION");
    expect(publishSpy).not.toHaveBeenCalled();
  });
  it("decide: 202 for a different officer; 409 not pending; 404 unknown; 400 bad body; 401/403", async () => {
    expect((await decide(R_PENDING, tok(R_OTHER))).statusCode).toBe(202);
    expect((await decide(R_DONE, tok(R_OTHER))).json().error.code).toBe("RECOVERY_NOT_PENDING");
    expect((await decide("f9999999-9999-4999-8999-999999999999", tok(R_OTHER))).statusCode).toBe(404);
    expect((await decide(R_PENDING, tok(R_OTHER), { nope: 1 })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/v1/revenue/recovery-referrals/${R_PENDING}/decide`, payload: { approve: true } })).statusCode).toBe(401);
    expect((await decide(R_PENDING, tok(R_OTHER, ["employee"]))).statusCode).toBe(403);
  });
  it("GET /recovery-referrals?status=pending is the checker queue; GET /:id returns one", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/revenue/recovery-referrals?status=pending", headers: tok(R_OTHER) });
    expect(list.json().data.map((x: { id: string }) => x.id)).toEqual([R_PENDING]);
    const one = await app.inject({ method: "GET", url: `/v1/revenue/recovery-referrals/${R_PENDING}`, headers: tok(R_OTHER) });
    expect(one.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/revenue/recovery-referrals/f9999999-9999-4999-8999-999999999999", headers: tok(R_OTHER) })).statusCode).toBe(404);
  });
  it("GET /assessees/:id/recovery-readiness shows amount, notices and eligibility", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${R_ASSESSEE}/recovery-readiness`, headers: tok(R_OTHER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ outstandingMinor: "500000", eligible: true });
    expect(res.json().data.notices[0]).toMatchObject({ noticeNo: "DN-1", lapsed: true });
  });
  it("POST /demand-notices: 202 valid; 400 bad period; 403 wrong role", async () => {
    const body = { assesseeId: R_ASSESSEE, noticeNo: "DN-9", servedOn: "2026-08-01", noticePeriodDays: 30 };
    expect((await app.inject({ method: "POST", url: "/v1/revenue/demand-notices", headers: tok(R_OTHER), payload: body })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: "/v1/revenue/demand-notices", headers: tok(R_OTHER), payload: { ...body, noticePeriodDays: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/revenue/demand-notices", headers: tok(R_OTHER, ["employee"]), payload: body })).statusCode).toBe(403);
  });
  it("POST /demand-notices pre-checks synchronously: 409 duplicate, 404 unknown assessee/demand, 422 mismatch/future date; nothing published", async () => {
    const body = { assesseeId: R_ASSESSEE, noticeNo: "DN-10", servedOn: "2026-08-01", noticePeriodDays: 30 };
    const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/revenue/demand-notices", headers: tok(R_OTHER), payload });
    publishSpy.mockClear();
    const dup = await post({ ...body, noticeNo: "DN-DUP" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("DUPLICATE_NOTICE_NO");
    expect((await post({ ...body, assesseeId: "f6666666-6666-4666-8666-666666666660" })).statusCode).toBe(404);
    expect((await post({ ...body, demandId: "f1010101-1010-4010-8010-101010101010" })).statusCode).toBe(404);
    const mismatch = await post({ ...body, demandId: "f8888888-8888-4888-8888-888888888888" });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error.code).toBe("DEMAND_ASSESSEE_MISMATCH");
    expect((await post({ ...body, servedOn: "2999-01-01" })).statusCode).toBe(422);
    expect(publishSpy).not.toHaveBeenCalled();
    expect((await post({ ...body, demandId: "f7777777-7777-4777-8777-777777777777" })).statusCode).toBe(202);
  });
});
