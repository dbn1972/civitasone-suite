/**
 * UAT B8-F68 (P1 accept-nonexistent), revenue-service assessment remission:
 *  - POST /v1/revenue/assessments/:id/remit published assessmentRemit for ANY well-formed id
 *    and the consumer inserted a pending remission anyway, leaving an orphan row.
 *  - Sibling PATCH /:id/remit-decide had no existence check of its own (it relied on the pending
 *    remission, which an orphan row satisfies).
 * Now both routes do a tenant-scoped existence read first (random id or another tenant's
 * assessment -> 404, nothing published), and the remit consumer throws NonRetryableError and
 * writes nothing when the assessment does not exist. Real DB, no db/consumer mocks.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { isNonRetryable, type Handler, type Queue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { assessments, remissions } from "../src/modules/assessment/schema.js";
import { registerAssessmentConsumers } from "../src/modules/assessment/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "b8f68000-0000-4000-8000-0000000000a1";
const OTHER_TENANT = "b8f68000-0000-4000-8000-0000000000a2";
const MAKER = "b8f68000-0000-4000-8000-00000000a001";
const CHECKER = "b8f68000-0000-4000-8000-00000000c001";
const ASSESSMENT = "b8f68000-0000-4000-8000-0000000a5e55";

const bearer = (actor = MAKER, tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: tenantId, roles: ["revenue_admin"], sid: "sess-b8-f68" }, SECRET, 3600)}`,
});
const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
const remissionsFor = (assessmentId: string) =>
  inTenant((tx) => tx.select().from(remissions).where(and(eq(remissions.tenantId, TENANT), eq(remissions.assessmentId, assessmentId))));

async function clean() {
  await inTenant(async (tx) => {
    await tx.delete(remissions).where(eq(remissions.tenantId, TENANT));
    await tx.delete(assessments).where(eq(assessments.tenantId, TENANT));
  });
}

// Consumer handlers captured from a tenant-aware queue (same wrapping as the worker).
const handlers: Record<string, Handler> = {};
const capture = {
  subscribe: (topic: string, h: Handler) => { handlers[topic] = withTenantConsumer(h) as Handler; },
} as unknown as Queue;
const remitMsg = (assessmentId: string) => ({
  messageId: randomUUID(), type: COMMANDS.assessmentRemit, tenantId: TENANT, actorId: MAKER,
  correlationId: randomUUID(), schemaVersion: "1.0",
  payload: { assessmentId, reason: "flood relief", remissionPercent: 25 },
});

let app: FastifyInstance;
beforeAll(async () => {
  await clean();
  app = await buildApp();
  await app.ready();
  registerAssessmentConsumers(capture);
  await inTenant((tx) => tx.insert(assessments).values({
    id: ASSESSMENT, tenantId: TENANT, assesseeId: randomUUID(), rateHeadId: randomUUID(),
    financialYear: "2026-27", baseValue: 1_000_000n, exemptions: [], status: "active",
    createdBy: MAKER, updatedBy: MAKER,
  }));
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await clean();
  await app.close();
  await sqlClient.end();
});

describe("UAT B8-F68: POST /assessments/:id/remit needs an existing assessment", () => {
  const body = { reason: "flood relief", remissionPercent: 25 };
  const remit = (id: string, tenantId = TENANT) =>
    app.inject({ method: "POST", url: `/v1/revenue/assessments/${id}/remit`, headers: bearer(MAKER, tenantId), payload: body });

  it("random id -> 404 NOT_FOUND, nothing published, no remission row", async () => {
    const publish = vi.spyOn(queue, "publish");
    const id = randomUUID();
    const res = await remit(id);
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).toContain("NOT_FOUND");
    expect(publish).not.toHaveBeenCalled();
    expect(await remissionsFor(id)).toHaveLength(0);
  });

  it("another tenant's real assessment -> 404 (tenant-scoped read), nothing published", async () => {
    const publish = vi.spyOn(queue, "publish");
    expect((await remit(ASSESSMENT, OTHER_TENANT)).statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });

  it("existing assessment -> 202 and assessmentRemit is published", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await remit(ASSESSMENT);
    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toBe(COMMANDS.assessmentRemit);
  });

  it("body validation still runs before the existence read (empty body -> 400)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/revenue/assessments/${randomUUID()}/remit`, headers: bearer(), payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe("UAT B8-F68: the remit consumer never writes an orphan remission", () => {
  it("nonexistent assessment -> NonRetryableError NOT_FOUND, no row written", async () => {
    const id = randomUUID();
    const err = await handlers[COMMANDS.assessmentRemit]!(remitMsg(id) as never).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isNonRetryable(err)).toBe(true);
    expect((err as Error).message).toBe("NOT_FOUND");
    expect(await remissionsFor(id)).toHaveLength(0);
  });

  it("existing assessment -> a pending remission row is written", async () => {
    await handlers[COMMANDS.assessmentRemit]!(remitMsg(ASSESSMENT) as never);
    const rows = await remissionsFor(ASSESSMENT);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.makerUserId).toBe(MAKER);
  });
});

describe("UAT B8-F68 sibling: PATCH /assessments/:id/remit-decide needs an existing assessment", () => {
  const decide = (id: string) =>
    app.inject({ method: "PATCH", url: `/v1/revenue/assessments/${id}/remit-decide`, headers: bearer(CHECKER), payload: { approve: true } });

  it("an orphan pending remission (no assessment) -> 404, nothing published", async () => {
    const orphan = randomUUID();
    await inTenant((tx) => tx.insert(remissions).values({
      tenantId: TENANT, assessmentId: orphan, reason: "legacy orphan", remissionPercent: 10, status: "pending", makerUserId: MAKER,
    }));
    const publish = vi.spyOn(queue, "publish");
    const res = await decide(orphan);
    expect(res.statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });

  it("existing assessment with a pending remission by another maker -> 202", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await decide(ASSESSMENT);
    expect(res.statusCode).toBe(202);
    expect(publish.mock.calls[0]![0]).toBe(COMMANDS.assessmentRemitDecide);
  });
});
