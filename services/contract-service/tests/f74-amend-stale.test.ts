/**
 * F74 (UAT bundle 8) — stale contract amendment applied after activation.
 *
 * Live UAT (contracts 7643911f…, 2678b6d5…, c8176730…): PATCH /amend on an
 * APPROVED (not yet active) contract answered 202; the worker rejected it with a
 * plain (retryable) DomainError, the queue kept redelivering it, and once the
 * contract was activated the stale +1 amendment was applied (value 1025001
 * instead of 1025000).
 *
 *  1. Route: amend on approved-not-active -> 409 INVALID_STATUS (404 if missing),
 *     and nothing is applied after a later activate; amend on active still works.
 *  2. Consumer: a business-rule rejection is NonRetryable, so a refused amend in
 *     the queue's retry backoff can no longer land after activation.
 *  3. Consumer: every contract lifecycle handler's business-rule / not-found
 *     rejection is NonRetryable; a command issued against an older contract
 *     version is refused (optimistic concurrency).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, isNonRetryable } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { queue as infraQueue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { contractContracts, contractAmendments } from "../src/modules/contracts/schema.js";
import { registerContractConsumers } from "../src/modules/contracts/consumer.js";
import { COMMANDS } from "../src/topics.js";

const MAKER   = "00000000-f74a-4000-8000-0000000000a1";
const CHECKER = "00000000-f74a-4000-8000-0000000000a2";
const TENANT  = "11111111-f74a-4000-8000-0000000000f4";
// JWT secret comes from vitest.config.ts env (no literal here).
const SECRET  = process.env.JWT_SECRET ?? "";
const BASE_VALUE = 1_025_000n;

function auth(sub: string) {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles: ["procurement_admin"] }, SECRET, 3600)}` };
}

function wireTenantAwareQueue<Q extends Queue>(q: Q): Q {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(async (tx) => fn(tx as unknown as typeof db)));

async function seed(status: string, version = 1): Promise<string> {
  const id = randomUUID();
  await inTenant((tx) => tx.insert(contractContracts).values({
    id, tenantId: TENANT, contractNo: `F74-${id.slice(0, 8)}`, vendorId: randomUUID(),
    title: "F74 stale amend", valueMinor: BASE_VALUE, currency: "INR",
    startDate: "2026-07-01", expiry: "2027-06-30", status, version,
    createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}

async function contract(id: string) {
  const [row] = await inTenant((tx) => tx.select().from(contractContracts).where(eq(contractContracts.id, id)));
  return row;
}

async function amendments(id: string) {
  return inTenant((tx) => tx.select().from(contractAmendments).where(eq(contractAmendments.contractId, id)));
}

async function wipe() {
  await inTenant(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(contractAmendments).where(eq(contractAmendments.tenantId, TENANT));
    await tx.delete(contractContracts).where(eq(contractContracts.tenantId, TENANT));
  });
}

function envelope(type: string, actorId: string, payload: Record<string, unknown>) {
  const messageId = randomUUID();
  return {
    messageId, type, tenantId: TENANT, actorId, correlationId: `f74-${messageId.slice(0, 8)}`,
    schemaVersion: "1.0", timestamp: new Date().toISOString(), payload,
  };
}

beforeAll(async () => { await wipe(); });
afterAll(async () => { await wipe(); });

// ── 1. Route: synchronous state check + end-to-end via the real consumer ────
describe("F74 route: PATCH /v1/contract/contracts/:id/amend", () => {
  let app: FastifyInstance;
  const q = infraQueue as unknown as MemoryQueue;

  beforeAll(async () => {
    app = await buildApp();
    registerContractConsumers(wireTenantAwareQueue(q));
    await q.start();
  });
  afterAll(async () => { await q.drain(); await app.close(); });

  it("approved-not-active -> 409 INVALID_STATUS, and nothing is applied after a later activate", async () => {
    const id = await seed("approved");

    const refused = await app.inject({
      method: "PATCH", url: `/v1/contract/contracts/${id}/amend`, headers: auth(MAKER),
      payload: { reason: "pre-activation variation", valueDelta: 1 },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("INVALID_STATUS");

    const activated = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${id}/activate`, headers: auth(CHECKER), payload: {},
    });
    expect(activated.statusCode).toBe(202);
    await q.drain();

    const row = await contract(id);
    expect(row?.status).toBe("active");
    expect(row?.valueMinor).toBe(BASE_VALUE);
    expect(await amendments(id)).toHaveLength(0);
  });

  it("missing contract -> 404", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/contract/contracts/${randomUUID()}/amend`, headers: auth(MAKER),
      payload: { reason: "no such contract", valueDelta: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("a valid amend on an active contract still applies", async () => {
    const id = await seed("active");
    const res = await app.inject({
      method: "PATCH", url: `/v1/contract/contracts/${id}/amend`, headers: auth(CHECKER),
      payload: { reason: "scope increase", valueDelta: 25_000 },
    });
    expect(res.statusCode).toBe(202);
    await q.drain();

    const row = await contract(id);
    expect(row?.valueMinor).toBe(BASE_VALUE + 25_000n);
    expect(row?.version).toBe(2);
    const ams = await amendments(id);
    expect(ams).toHaveLength(1);
    expect(ams[0]?.valueDelta).toBe(25_000n);
    expect(ams[0]?.approvedBy).toBe(CHECKER);
  });
});

// ── 2. Consumer: a refused amend in retry backoff never lands after activation ─
describe("F74 consumer: refused amend is dead-lettered, not redelivered", () => {
  it("amend on approved contract is not applied when the contract is activated during the retry window", async () => {
    const id = await seed("approved");
    // Generous retry budget, as on the live RabbitMQ driver: a RETRYABLE
    // rejection stays in backoff long enough to see the activation.
    const q = wireTenantAwareQueue(new MemoryQueue({ maxAttempts: 10 }));
    registerContractConsumers(q);
    await q.start();

    // A pre-F74 in-flight command (no expectedVersion, never route-checked).
    const amend = envelope(COMMANDS.contractAmend, MAKER, { id, tenantId: TENANT, reason: "stale variation", valueDelta: 1 });
    await q.publish(COMMANDS.contractAmend, amend);
    await new Promise((r) => setTimeout(r, 100)); // first attempt has run and been refused
    await q.publish(COMMANDS.contractActivate, envelope(COMMANDS.contractActivate, CHECKER, { id, tenantId: TENANT }));
    await q.drain();
    await q.stop();

    const row = await contract(id);
    expect(row?.status).toBe("active");
    expect(row?.valueMinor).toBe(BASE_VALUE);
    expect(await amendments(id)).toHaveLength(0);
    const dead = q.dlq.filter((d) => d.msg.messageId === amend.messageId);
    expect(dead).toHaveLength(1);
    expect(dead[0]?.error).toContain("INVALID_STATUS");
  });
});

// ── 3. Every contract handler: business-rule rejection is NonRetryable ────────
describe("F74 consumer: business-rule rejections are NonRetryable", () => {
  const handlers = new Map<string, Handler>();
  beforeAll(() => {
    const capture = {
      subscribe: (topic: string, h: Handler) => { handlers.set(topic, h); },
    } as unknown as Queue;
    registerContractConsumers(capture);
  });

  async function rejection(topic: string, actor: string, payload: Record<string, unknown>): Promise<unknown> {
    const h = handlers.get(topic);
    if (!h) throw new Error(`no handler for ${topic}`);
    try {
      await h(envelope(topic, actor, payload) as never);
    } catch (err) {
      return err;
    }
    throw new Error(`${topic} did not reject`);
  }

  let approved: string; let active: string; let closed: string; let draft: string;
  beforeEach(async () => {
    approved = await seed("approved");
    active = await seed("active", 3);
    closed = await seed("closed");
    draft = await seed("draft");
  });

  const cases: Array<[string, string, () => Record<string, unknown>, string]> = [
    ["amend on approved",       COMMANDS.contractAmend,     () => ({ id: approved, tenantId: TENANT, reason: "x variation", valueDelta: 1 }), "INVALID_STATUS"],
    ["amend on closed",         COMMANDS.contractAmend,     () => ({ id: closed, tenantId: TENANT, reason: "x variation", valueDelta: 1 }), "INVALID_STATUS"],
    ["approve on active",       COMMANDS.contractApprove,   () => ({ id: active, tenantId: TENANT }), "INVALID_TRANSITION"],
    ["activate on draft",       COMMANDS.contractActivate,  () => ({ id: draft, tenantId: TENANT }), "INVALID_TRANSITION"],
    ["close on approved",       COMMANDS.contractClose,     () => ({ id: approved, tenantId: TENANT }), "INVALID_TRANSITION"],
    ["terminate on closed",     COMMANDS.contractTerminate, () => ({ id: closed, tenantId: TENANT, reason: "breach" }), "INVALID_TRANSITION"],
    ["submit-approval on active", COMMANDS.contractSubmitApproval, () => ({ id: active, tenantId: TENANT }), "INVALID_TRANSITION"],
    ["activate missing",        COMMANDS.contractActivate,  () => ({ id: randomUUID(), tenantId: TENANT }), "CONTRACT_NOT_FOUND"],
    ["amend missing",           COMMANDS.contractAmend,     () => ({ id: randomUUID(), tenantId: TENANT, reason: "x variation", valueDelta: 1 }), "CONTRACT_NOT_FOUND"],
    ["milestone on missing",    COMMANDS.milestoneComplete, () => ({ contractId: randomUUID(), milestoneId: randomUUID(), tenantId: TENANT, achievedDate: "2026-08-01" }), "CONTRACT_NOT_FOUND"],
    ["milestone missing",       COMMANDS.milestoneMarkLate, () => ({ contractId: active, milestoneId: randomUUID(), tenantId: TENANT, achievedDate: "2026-08-01" }), "MILESTONE_NOT_FOUND"],
    ["bond on missing contract", COMMANDS.bondRegister,     () => ({ id: randomUUID(), contractId: randomUUID(), tenantId: TENANT, bondType: "performance", amountMinor: 1, issuer: "Bank", referenceNo: "R1", validFrom: "2026-07-01", validTo: "2027-07-01" }), "CONTRACT_NOT_FOUND"],
    ["bond transition missing", COMMANDS.bondTransition,    () => ({ contractId: active, bondId: randomUUID(), tenantId: TENANT, toStatus: "released" }), "BOND_NOT_FOUND"],
  ];

  for (const [name, topic, payload, code] of cases) {
    it(`${name} -> NonRetryable ${code}`, async () => {
      const err = await rejection(topic, CHECKER, payload());
      expect(isNonRetryable(err)).toBe(true);
      expect(String((err as Error).message)).toContain(code);
    });
  }

  it("self-approval (SoD) in the consumer is NonRetryable", async () => {
    const err = await rejection(COMMANDS.contractApprove, MAKER, { id: draft, tenantId: TENANT });
    expect(isNonRetryable(err)).toBe(true);
    expect(String((err as Error).message)).toContain("SOD_VIOLATION");
  });

  it("amend issued against an older contract version is refused and not applied", async () => {
    const err = await rejection(COMMANDS.contractAmend, CHECKER, {
      id: active, tenantId: TENANT, reason: "stale variation", valueDelta: 1, expectedVersion: 2,
    });
    expect(isNonRetryable(err)).toBe(true);
    expect(String((err as Error).message)).toContain("STALE_COMMAND");
    expect((await contract(active))?.valueMinor).toBe(BASE_VALUE);
    expect(await amendments(active)).toHaveLength(0);
  });

  it("amend carrying the current version applies", async () => {
    const h = handlers.get(COMMANDS.contractAmend)!;
    await h(envelope(COMMANDS.contractAmend, CHECKER, {
      id: active, tenantId: TENANT, reason: "current variation", valueDelta: 5, expectedVersion: 3,
    }) as never);
    expect((await contract(active))?.valueMinor).toBe(BASE_VALUE + 5n);
    expect(await amendments(active)).toHaveLength(1);
  });
});
