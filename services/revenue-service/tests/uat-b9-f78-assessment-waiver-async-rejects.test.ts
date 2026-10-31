/**
 * UAT B9-F78a / F78b / B9-waiver (revenue-service): "202, then the worker silently drops or
 * retries forever".
 *  - F78a: PATCH /assessments/:id/revise returned 202 for an unknown id; the consumer threw a plain
 *    (retryable) Error, so the message looped until the DLQ.
 *  - F78b: POST /assessments never checked assesseeId / rateHeadId for the tenant. An unknown rate
 *    head looped on a retryable DomainError; an unknown assessee became an orphan assessment (no FK).
 *  - B9-waiver: an over-cap waiver returned 202 and the worker dropped it (retryable DomainError,
 *    no row, nothing to the caller).
 * Now: tenant-scoped synchronous checks (404 for the path id, 422 for a bad body reference or an
 * over-cap amount) and the consumers reject business-rule failures with NonRetryableError, so the
 * queue logs + records a single 'rejected' outcome with the reason instead of retrying.
 * Real DB, no db/consumer mocks.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { isNonRetryable, MemoryQueue, type CommandOutcome, type Handler, type Queue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { assessments, demands } from "../src/modules/assessment/schema.js";
import { assessees } from "../src/modules/assessee/schema.js";
import { rateHeads, rateSlabs } from "../src/modules/rate-engine/schema.js";
import { waivers } from "../src/modules/trade-license/schema.js";
import { registerAssessmentConsumers } from "../src/modules/assessment/consumer.js";
import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "b9f78000-0000-4000-8000-0000000000a1";
const OTHER_TENANT = "b9f78000-0000-4000-8000-0000000000a2";
const ACTOR = "b9f78000-0000-4000-8000-00000000a001";
const ASSESSEE = "b9f78000-0000-4000-8000-0000000a5e01";
const RATE_HEAD = "b9f78000-0000-4000-8000-0000000a7e01";
const ASSESSMENT = "b9f78000-0000-4000-8000-0000000a5501";
const DEMAND = "b9f78000-0000-4000-8000-0000000de001"; // penalty 100 + interest 50 -> cap 150 ("both")

const bearer = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["revenue_admin"], sid: "sess-b9-f78" }, SECRET, 3600)}`,
});
const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

async function clean() {
  await inTenant(async (tx) => {
    await tx.delete(waivers).where(eq(waivers.tenantId, TENANT));
    await tx.delete(demands).where(eq(demands.tenantId, TENANT));
    await tx.delete(assessments).where(eq(assessments.tenantId, TENANT));
    await tx.delete(rateSlabs).where(eq(rateSlabs.tenantId, TENANT));
    await tx.delete(rateHeads).where(eq(rateHeads.tenantId, TENANT));
    await tx.delete(assessees).where(eq(assessees.tenantId, TENANT));
  });
}

// Consumer handlers captured with the same tenant wrapping as the worker.
const handlers: Record<string, Handler> = {};
const capture = {
  subscribe: (topic: string, h: Handler) => { handlers[topic] = withTenantConsumer(h) as Handler; },
} as unknown as Queue;
const envelope = (type: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
  correlationId: randomUUID(), schemaVersion: "1.0", payload,
});
const run = (type: string, payload: Record<string, unknown>) =>
  handlers[type]!(envelope(type, payload) as never).then(() => null, (e: unknown) => e);

let app: FastifyInstance;
beforeAll(async () => {
  await clean();
  app = await buildApp();
  await app.ready();
  registerAssessmentConsumers(capture);
  registerArrearsConsumers(capture);
  await inTenant(async (tx) => {
    await tx.insert(assessees).values({
      id: ASSESSEE, tenantId: TENANT, assesseeType: "property", identifierNo: "B9-F78-P1",
      ownerName: "B9 F78 Owner", address: "1 Test Road", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(rateHeads).values({
      id: RATE_HEAD, tenantId: TENANT, code: "B9F78", name: "B9 F78 property tax",
      category: "property_tax", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(rateSlabs).values({
      tenantId: TENANT, rateHeadId: RATE_HEAD, slabType: "flat", rateValue: 50_000n,
      effectiveFrom: "2000-01-01", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(assessments).values({
      id: ASSESSMENT, tenantId: TENANT, assesseeId: ASSESSEE, rateHeadId: RATE_HEAD,
      financialYear: "2026-27", baseValue: 1_000_000n, exemptions: [], status: "active",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(demands).values({
      id: DEMAND, tenantId: TENANT, assesseeId: ASSESSEE, assessmentId: ASSESSMENT, rateHeadId: RATE_HEAD,
      financialYear: "2026-27", dueDate: "2026-04-30", principalMinor: 10_000n, penaltyMinor: 100n,
      interestMinor: 50n, netMinor: 10_150n, computeSnapshot: {}, createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await clean();
  await app.close();
  await sqlClient.end();
});

// ── F78a ──────────────────────────────────────────────────────────────────────
describe("UAT B9-F78a: PATCH /assessments/:id/revise needs an existing assessment", () => {
  const body = { version: 1, reason: "b9 revise", newBaseValue: "2000000" };
  const revise = (id: string, tenantId = TENANT) =>
    app.inject({ method: "PATCH", url: `/v1/revenue/assessments/${id}/revise`, headers: bearer(tenantId), payload: body });

  it("random id -> 404 NOT_FOUND, nothing published", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await revise(randomUUID());
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).toContain("NOT_FOUND");
    expect(publish).not.toHaveBeenCalled();
  });

  it("another tenant's real assessment -> 404 (tenant-scoped read)", async () => {
    const publish = vi.spyOn(queue, "publish");
    expect((await revise(ASSESSMENT, OTHER_TENANT)).statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });

  it("existing assessment -> 202 and assessmentRevise is published", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    expect((await revise(ASSESSMENT)).statusCode).toBe(202);
    expect(publish.mock.calls[0]![0]).toBe(COMMANDS.assessmentRevise);
  });

  it("consumer: unknown assessment -> NonRetryableError NOT_FOUND (was a plain retryable Error)", async () => {
    const err = await run(COMMANDS.assessmentRevise, { assessmentId: randomUUID(), ...body });
    expect(isNonRetryable(err)).toBe(true);
    expect((err as Error).message).toBe("NOT_FOUND");
  });

  it("consumer: stale version -> NonRetryableError VERSION_CONFLICT, assessment unchanged", async () => {
    const err = await run(COMMANDS.assessmentRevise, { assessmentId: ASSESSMENT, ...body, version: 99 });
    expect(isNonRetryable(err)).toBe(true);
    expect((err as Error).message).toBe("VERSION_CONFLICT");
    const [row] = await inTenant((tx) => tx.select().from(assessments).where(eq(assessments.id, ASSESSMENT)));
    expect(row!.baseValue).toBe(1_000_000n);
  });
});

// ── F78b ──────────────────────────────────────────────────────────────────────
describe("UAT B9-F78b: POST /assessments needs an existing assessee and rate head", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    assesseeId: ASSESSEE, rateHeadId: RATE_HEAD, financialYear: "2027-28", baseValue: "1000000", ...over,
  });
  const create = (payload: Record<string, unknown>, tenantId = TENANT) =>
    app.inject({ method: "POST", url: "/v1/revenue/assessments", headers: bearer(tenantId), payload });

  it("unknown assesseeId -> 422 ASSESSEE_NOT_FOUND, nothing published", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await create(body({ assesseeId: randomUUID() }));
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain("ASSESSEE_NOT_FOUND");
    expect(publish).not.toHaveBeenCalled();
  });

  it("unknown rateHeadId -> 422 RATE_HEAD_NOT_FOUND, nothing published", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await create(body({ rateHeadId: randomUUID() }));
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain("RATE_HEAD_NOT_FOUND");
    expect(publish).not.toHaveBeenCalled();
  });

  it("another tenant's real assessee + rate head -> 422 (tenant-scoped reads)", async () => {
    const publish = vi.spyOn(queue, "publish");
    expect((await create(body(), OTHER_TENANT)).statusCode).toBe(422);
    expect(publish).not.toHaveBeenCalled();
  });

  it("both references exist -> 202 and assessmentCreate is published", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    expect((await create(body())).statusCode).toBe(202);
    expect(publish.mock.calls[0]![0]).toBe(COMMANDS.assessmentCreate);
  });

  it("consumer: unknown assessee -> NonRetryableError, no orphan assessment written", async () => {
    const ghost = randomUUID();
    const err = await run(COMMANDS.assessmentCreate, body({ assesseeId: ghost }));
    expect(isNonRetryable(err)).toBe(true);
    expect((err as Error).message).toBe("ASSESSEE_NOT_FOUND");
    expect(await inTenant((tx) => tx.select().from(assessments).where(eq(assessments.assesseeId, ghost)))).toHaveLength(0);
  });

  it("consumer: unknown rate head -> NonRetryableError RATE_HEAD_NOT_FOUND", async () => {
    const err = await run(COMMANDS.assessmentCreate, body({ rateHeadId: randomUUID() }));
    expect(isNonRetryable(err)).toBe(true);
    expect((err as Error).message).toBe("RATE_HEAD_NOT_FOUND");
  });

  it("consumer: valid references -> assessment + demand written", async () => {
    expect(await run(COMMANDS.assessmentCreate, body({ financialYear: "2028-29" }))).toBeNull();
    const rows = await inTenant((tx) => tx.select().from(assessments)
      .where(and(eq(assessments.tenantId, TENANT), eq(assessments.financialYear, "2028-29"))));
    expect(rows).toHaveLength(1);
  });
});

// ── B9-waiver ─────────────────────────────────────────────────────────────────
describe("UAT B9-waiver: an over-cap waiver is rejected, never a silent 202", () => {
  const waive = (amountMinor: string, over: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST", url: "/v1/revenue/waivers", headers: bearer(),
      payload: { demandId: DEMAND, waiverType: "both", amountMinor, reason: "b9 waiver", ...over },
    });
  const waiverRows = () => inTenant((tx) => tx.select().from(waivers).where(eq(waivers.demandId, DEMAND)));

  it("amount over the cap (penalty+interest = 150) -> 422 WAIVER_EXCEEDS_CAP, nothing published", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await waive("151");
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain("WAIVER_EXCEEDS_CAP");
    expect(publish).not.toHaveBeenCalled();
  });

  it("component cap: 'penalty' only allows 100 -> 101 is 422", async () => {
    const publish = vi.spyOn(queue, "publish");
    expect((await waive("101", { waiverType: "penalty" })).statusCode).toBe(422);
    expect(publish).not.toHaveBeenCalled();
  });

  it("unknown demandId -> 422 DEMAND_NOT_FOUND, nothing published", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await waive("10", { demandId: randomUUID() });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain("DEMAND_NOT_FOUND");
    expect(publish).not.toHaveBeenCalled();
  });

  it("amount within the cap -> 202 and waiverCreate is published", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    expect((await waive("150")).statusCode).toBe(202);
    expect(publish.mock.calls[0]![0]).toBe(COMMANDS.waiverCreate);
  });

  it("consumer: over cap -> NonRetryableError WAIVER_EXCEEDS_CAP, no row", async () => {
    const err = await run(COMMANDS.waiverCreate, { demandId: DEMAND, amountMinor: "151", reason: "x", waiverType: "both" });
    expect(isNonRetryable(err)).toBe(true);
    expect((err as Error).message).toMatch(/^WAIVER_EXCEEDS_CAP: /);
    expect(await waiverRows()).toHaveLength(0);
  });

  it("consumer: unknown demand -> NonRetryableError DEMAND_NOT_FOUND", async () => {
    const err = await run(COMMANDS.waiverCreate, { demandId: randomUUID(), amountMinor: "1", reason: "x" });
    expect(isNonRetryable(err)).toBe(true);
    expect((err as Error).message).toMatch(/^DEMAND_NOT_FOUND: /);
  });

  it("queue: an over-cap waiver is attempted once and recorded 'rejected' with the reason, not retried", async () => {
    const q = new MemoryQueue({ maxAttempts: 3 });
    const outcomes: CommandOutcome[] = [];
    let attempts = 0;
    q.subscribe(COMMANDS.waiverCreate, async (m) => { attempts++; await handlers[COMMANDS.waiverCreate]!(m); },
      { onOutcome: (o) => { outcomes.push(o); } });
    const errLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await q.publish(COMMANDS.waiverCreate, {
      messageId: randomUUID(), type: COMMANDS.waiverCreate, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload:{ demandId: DEMAND, amountMinor: "999999", reason: "x", waiverType: "both" },
    } as never);
    await q.drain();
    expect(attempts).toBe(1);
    expect(outcomes).toEqual([expect.objectContaining({ status: "rejected", reason: expect.stringMatching(/^WAIVER_EXCEEDS_CAP: /) })]);
    expect(errLog.mock.calls.flat().join(" ")).toContain("WAIVER_EXCEEDS_CAP");
    expect(await waiverRows()).toHaveLength(0);
  });

  it("consumer: within cap -> a pending waiver row; the remaining cap is then 0 (route 422s)", async () => {
    expect(await run(COMMANDS.waiverCreate, { demandId: DEMAND, amountMinor: "150", reason: "ok", waiverType: "both" })).toBeNull();
    const rows = await waiverRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");
    expect((await waive("1")).statusCode).toBe(422);
  });
});
