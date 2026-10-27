/**
 * GAP-ESTAB-LIBRARY-ISSUES-05 (owner decision #29): loan renewal and return condition are in UAT
 * scope; overdue FINES are not (the screen says fine rules are not configured). Real DB + consumers.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { estabLibraryBooks, estabIssues } from "../src/modules/facilities/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerFacilitiesConsumers } from "../src/modules/facilities/consumer.js";
import { COMMANDS } from "../src/topics.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function mint(sub: string, roles: string[], tid: string): string {
  const n = Math.floor(Date.now() / 1000);
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ sub, iss: "civitasone-dev", tid, tenantId: tid, sid: "t", email: "t@t.dev", name: "Test", roles, iat: n, exp: n + 3600 });
  const s = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
const auth = (actor: string, tid: string, roles = ["estab_officer"]) => ({ authorization: `Bearer ${mint(actor, roles, tid)}`, "x-tenant-id": tid });

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const tenants: string[] = [];
const fresh = () => { const t = randomUUID(); tenants.push(t); return t; };
const DAY = 864e5;

async function seed(tenantId: string, actor: string, dueInDays = 7) {
  const bookId = randomUUID(); const issueId = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(estabLibraryBooks).values({
      id: bookId, tenantId, accessionNo: `ACC/${bookId.slice(0, 8)}`, title: "Manual of Office Procedure",
      copiesTotal: 2, copiesAvailable: 1, createdBy: actor, updatedBy: actor,
    });
    await tx.insert(estabIssues).values({
      id: issueId, tenantId, bookId, employeeRef: actor, dueAt: new Date(Date.now() + dueInDays * DAY),
      status: "issued", createdBy: actor, updatedBy: actor,
    });
  }));
  return { bookId, issueId };
}

type Row = { id: string; status: string; dueAt: string; renewalCount?: number; returnCondition?: string | null; returnNotes?: string | null };
async function summary(app: FastifyInstance, tenantId: string, actor: string, issueId: string): Promise<Row | undefined> {
  const res = await app.inject({ method: "GET", url: "/v1/estab/library/issues", headers: auth(actor, tenantId) });
  expect(res.statusCode).toBe(200);
  return (res.json() as Row[]).find((r) => r.id === issueId);
}

let app: FastifyInstance;
let q: Queue;

beforeAll(async () => {
  app = await buildApp();
  q = wire(new MemoryQueue());
  registerFacilitiesConsumers(q);
  await q.start();
});
afterAll(async () => {
  await q.stop();
  for (const tenantId of tenants) {
    await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      await tx.delete(estabIssues).where(inArray(estabIssues.tenantId, [tenantId]));
      await tx.delete(estabLibraryBooks).where(inArray(estabLibraryBooks.tenantId, [tenantId]));
      await tx.delete(outboxMessages).where(inArray(outboxMessages.tenantId, [tenantId]));
    }));
  }
  await app.close();
  await sqlClient.end();
});

const settle = () => new Promise<void>((r) => setTimeout(r, 600));

function cmd(type: string, tenantId: string, actor: string, payload: Record<string, unknown>, messageId = randomUUID()) {
  return q.publish(type, { messageId, type, tenantId, actorId: actor, correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload });
}

describe("return condition (owner decision #29)", () => {
  it("the return route forwards a valid condition + notes on the command", async () => {
    const T = fresh(); const actor = randomUUID(); const { issueId } = await seed(T, actor);
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/library/issues/${issueId}/return`, headers: auth(actor, T),
      payload: { condition: "damaged", notes: "torn cover" },
    });
    expect(res.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.libraryReturn);
    expect(call?.[1].payload).toMatchObject({ issueId, condition: "damaged", notes: "torn cover" });
    spy.mockRestore();
  });

  it("rejects an unknown condition or over-long notes with 400, and still accepts a body-less return", async () => {
    const T = fresh(); const actor = randomUUID(); const { issueId } = await seed(T, actor);
    const bad = await app.inject({ method: "PATCH", url: `/v1/estab/library/issues/${issueId}/return`, headers: auth(actor, T), payload: { condition: "shredded" } });
    expect(bad.statusCode).toBe(400);
    const long = await app.inject({ method: "PATCH", url: `/v1/estab/library/issues/${issueId}/return`, headers: auth(actor, T), payload: { condition: "good", notes: "x".repeat(501) } });
    expect(long.statusCode).toBe(400);
    const plain = await app.inject({ method: "PATCH", url: `/v1/estab/library/issues/${issueId}/return`, headers: auth(actor, T) });
    expect(plain.statusCode).toBe(202);
  });

  it("the consumer persists the condition and the loan row reports it", async () => {
    const T = fresh(); const actor = randomUUID(); const { issueId } = await seed(T, actor);
    await cmd(COMMANDS.libraryReturn, T, actor, { issueId, tenantId: T, condition: "damaged", notes: "torn cover" });
    await settle();
    const row = await summary(app, T, actor, issueId);
    expect(row).toMatchObject({ status: "returned", returnCondition: "damaged", returnNotes: "torn cover" });
  });

  it("a legacy return without a condition leaves it null (not invented)", async () => {
    const T = fresh(); const actor = randomUUID(); const { issueId } = await seed(T, actor);
    await cmd(COMMANDS.libraryReturn, T, actor, { issueId, tenantId: T });
    await settle();
    const row = await summary(app, T, actor, issueId);
    expect(row?.status).toBe("returned");
    expect(row?.returnCondition ?? null).toBeNull();
  });
});

describe("loan renewal (owner decision #29)", () => {
  it("the renew route refuses a due date that is not after the current one (409) and accepts a later one (202)", async () => {
    const T = fresh(); const actor = randomUUID(); const { issueId } = await seed(T, actor, 7);
    const earlier = new Date(Date.now() + 3 * DAY).toISOString();
    const res = await app.inject({ method: "PATCH", url: `/v1/estab/library/issues/${issueId}/renew`, headers: auth(actor, T), payload: { dueAt: earlier } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_RENEWAL");
    const later = new Date(Date.now() + 21 * DAY).toISOString();
    const ok = await app.inject({ method: "PATCH", url: `/v1/estab/library/issues/${issueId}/renew`, headers: auth(actor, T), payload: { dueAt: later } });
    expect(ok.statusCode).toBe(202);
  });

  it("the consumer extends the due date and counts the renewal exactly once per command", async () => {
    const T = fresh(); const actor = randomUUID(); const { issueId } = await seed(T, actor, 7);
    const before = await summary(app, T, actor, issueId);
    expect(before?.renewalCount ?? 0).toBe(0);
    const later = new Date(Date.now() + 21 * DAY).toISOString();
    const mid = randomUUID();
    await cmd(COMMANDS.libraryRenew, T, actor, { issueId, tenantId: T, dueAt: later }, mid);
    await cmd(COMMANDS.libraryRenew, T, actor, { issueId, tenantId: T, dueAt: later }, mid); // redelivery
    await settle();
    const row = await summary(app, T, actor, issueId);
    expect(row?.renewalCount).toBe(1);
    expect(new Date(row!.dueAt).toISOString()).toBe(later);
  });

  it("a stale renew command (due date not after the current one) is ignored by the consumer", async () => {
    const T = fresh(); const actor = randomUUID(); const { issueId } = await seed(T, actor, 14);
    const earlier = new Date(Date.now() + 2 * DAY).toISOString();
    await cmd(COMMANDS.libraryRenew, T, actor, { issueId, tenantId: T, dueAt: earlier });
    await settle();
    const row = await summary(app, T, actor, issueId);
    expect(row?.renewalCount ?? 0).toBe(0);
    expect(new Date(row!.dueAt).getTime()).toBeGreaterThan(Date.now() + 10 * DAY);
  });
});
