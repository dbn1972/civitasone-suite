/**
 * Owner decision F1 (2026-10-27): the demand-notice period defaults to 15 days,
 * is tenant-configurable, and an officer serving a notice may only LENGTHEN it
 * (never go below the tenant default). Enforced in the serve consumer (the
 * authority) and pre-checked synchronously on the route.
 *
 * Consumer half DB-backed, no mocks. Route half mocks only the repo + infra.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { demandNotices, noticeSettings } from "../src/modules/arrears/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const ASSESSEE = randomUUID();
const OFFICER = randomUUID();
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
    await tx.delete(demandNotices).where(eq(demandNotices.tenantId, TENANT));
    await tx.delete(noticeSettings).where(eq(noticeSettings.tenantId, TENANT));
  }));
}
async function start() {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerArrearsConsumers(q);
  await q.start();
  return q;
}
let seq = 0;
async function serve(q: MemoryQueue, period?: number) {
  await q.publish(COMMANDS.demandNoticeServe, msg(COMMANDS.demandNoticeServe, OFFICER, {
    assesseeId: ASSESSEE, noticeNo: `DN-F1-${++seq}-${TENANT.slice(0, 8)}`, servedOn: daysAgo(1),
    ...(period === undefined ? {} : { noticePeriodDays: period }),
  }));
  await q.drain();
}
async function setDefault(q: MemoryQueue, days: number, actorRoles: string[] | null = ["revenue_admin"]) {
  await q.publish(COMMANDS.noticeSettingsSet, msg(COMMANDS.noticeSettingsSet, OFFICER, {
    defaultNoticePeriodDays: days, ...(actorRoles ? { actorRoles } : {}),
  }));
  await q.drain();
}
const notices = () => runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(demandNotices).where(eq(demandNotices.tenantId, TENANT))));
const settings = () => runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(noticeSettings).where(eq(noticeSettings.tenantId, TENANT))));

beforeAll(clean);
beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("F1: demand-notice period default (consumer)", () => {
  it("a tenant with no settings row defaults to 15 days: an omitted period is stored as 15 and the row is seeded 15", async () => {
    const q = await start();
    await serve(q);
    expect(q.dlq).toHaveLength(0);
    expect((await notices())[0]!.noticePeriodDays).toBe(15);
    expect((await settings())[0]!.defaultNoticePeriodDays).toBe(15);
    await q.stop();
  });

  it("an officer cannot SHORTEN the period below the tenant default: nothing is stored", async () => {
    const q = await start();
    await serve(q, 14);
    expect(q.dlq.length).toBeGreaterThan(0);
    expect(await notices()).toHaveLength(0);
    await q.stop();
  });

  it("an officer can keep (15) or lengthen (45) the period", async () => {
    const q = await start();
    await serve(q, 15);
    await serve(q, 45);
    expect(q.dlq).toHaveLength(0);
    expect((await notices()).map((n) => n.noticePeriodDays).sort((a, b) => a - b)).toEqual([15, 45]);
    await q.stop();
  });

  it("a tenant-configured default (30) applies: omitted -> 30, 20 refused, 31 accepted", async () => {
    const q = await start();
    await setDefault(q, 30);
    expect((await settings())[0]!.defaultNoticePeriodDays).toBe(30);
    await serve(q);
    await serve(q, 20);
    await serve(q, 31);
    expect((await notices()).map((n) => n.noticePeriodDays).sort((a, b) => a - b)).toEqual([30, 31]);
    expect(q.dlq).toHaveLength(1);
    await q.stop();
  });

  it("only revenue_admin / finance_admin may set the tenant default; others (or no roles) are refused", async () => {
    const q = await start();
    await setDefault(q, 30, ["revenue_officer"]);
    await setDefault(q, 30, ["tenant_admin"]);
    await setDefault(q, 30, null);
    expect(await settings()).toHaveLength(0);
    expect(q.dlq).toHaveLength(3);
    await setDefault(q, 20, ["finance_admin"]);
    expect((await settings())[0]!.defaultNoticePeriodDays).toBe(20);
    await q.stop();
  });

  it("changing the default is audited", async () => {
    const q = await start();
    await setDefault(q, 25);
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(rows.some((r) => r.eventType === "audit.event.record" && (r.payload as Record<string, unknown>).resourceType === "notice_settings")).toBe(true);
    await q.stop();
  });
});

// ── routes ───────────────────────────────────────────────────────────────────
const R_TENANT = "f1111111-1111-4111-8111-111111111120";
const R_ASSESSEE = "f6666666-6666-4666-8666-666666666620";
const R_USER = "f3333333-3333-4333-8333-333333333320";
const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const tok = (roles = ["revenue_officer"]) => ({ authorization: `Bearer ${signToken({ sub: R_USER, tid: R_TENANT, roles, sid: "s1" }, SECRET, 3600)}` });
const publishSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/modules/arrears/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/arrears/repo.js")>();
  return {
    ...original,
    precheckDemandNotice: vi.fn(async () => ({ assesseeExists: true, noticeExists: false, demandAssesseeId: undefined, defaultNoticePeriodDays: 30 })),
    getNoticeSettings: vi.fn(async () => ({ defaultNoticePeriodDays: 30, seeded: false })),
  };
});
vi.mock("../src/shared/infra.js", () => ({
  cache: { put: vi.fn(), get: vi.fn().mockResolvedValue(null), getOrLoad: vi.fn().mockResolvedValue([]), invalidate: vi.fn() },
  queue: {
    publish: (...a: unknown[]) => publishSpy(...a), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

describe("F1: demand-notice period default (routes)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/revenue/demand-notices", headers: tok(), payload: { assesseeId: R_ASSESSEE, noticeNo: "DN-R1", servedOn: "2026-08-01", ...payload } });

  it("422 NOTICE_PERIOD_BELOW_DEFAULT when shorter than the tenant default; nothing published", async () => {
    publishSpy.mockClear();
    const res = await post({ noticePeriodDays: 29 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("NOTICE_PERIOD_BELOW_DEFAULT");
    expect(publishSpy).not.toHaveBeenCalled();
  });
  it("202 when equal to / longer than the default, and when omitted (consumer applies the default)", async () => {
    expect((await post({ noticePeriodDays: 30 })).statusCode).toBe(202);
    expect((await post({ noticePeriodDays: 60 })).statusCode).toBe(202);
    expect((await post({})).statusCode).toBe(202);
  });
  it("GET /recovery-settings returns the tenant default; PUT needs revenue_admin / finance_admin", async () => {
    const get = await app.inject({ method: "GET", url: "/v1/revenue/recovery-settings", headers: tok() });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.defaultNoticePeriodDays).toBe(30);
    const put = (roles: string[], payload: Record<string, unknown> = { defaultNoticePeriodDays: 21 }) =>
      app.inject({ method: "PUT", url: "/v1/revenue/recovery-settings", headers: tok(roles), payload });
    publishSpy.mockClear();
    expect((await put(["revenue_officer"])).statusCode).toBe(403);
    expect((await put(["tenant_admin"])).statusCode).toBe(403);
    expect((await put(["finance_admin"], { defaultNoticePeriodDays: 0 })).statusCode).toBe(400);
    expect((await put(["finance_admin"], { defaultNoticePeriodDays: 366 })).statusCode).toBe(400);
    expect(publishSpy).not.toHaveBeenCalled();
    const ok = await put(["revenue_admin"]);
    expect(ok.statusCode).toBe(202);
    expect(publishSpy.mock.calls[0]![1].payload).toMatchObject({ defaultNoticePeriodDays: 21, actorRoles: ["revenue_admin"] });
  });
});
