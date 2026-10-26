/**
 * Owner decision #5 — POST /v1/revenue/adjustments refuses synchronously (422)
 * an amount above the movable principal of the source demand, and the new
 * GET /assessees/:id/movable-demands feeds the form the same figure.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "f1111111-1111-4111-8111-111111111111";
const USER_ID = "f2222222-2222-4222-8222-222222222222";
const FROM = "f3333333-3333-4333-8333-333333333333";
const TO = "f4444444-4444-4444-8444-444444444444";
const ASSESSEE = "f5555555-5555-4555-8555-555555555555";
const AUTH = { authorization: `Bearer ${signToken({ sub: USER_ID, tid: TENANT_ID, roles: ["revenue_admin"], sid: "s1" }, SECRET, 3600)}` };
const BAD = { authorization: `Bearer ${signToken({ sub: USER_ID, tid: TENANT_ID, roles: ["employee"], sid: "s1" }, SECRET, 3600)}` };
const publishSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/modules/collection/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/collection/repo.js")>();
  return {
    ...original,
    getMovableForDemand: vi.fn(async () => ({ outstanding: 1_000_000n, penalty: 150_000n, interest: 50_000n, movable: 800_000n })),
    listMovableForAssessee: vi.fn(async () => [{ demandId: FROM, outstandingMinor: "1000000", movableMinor: "800000" }]),
  };
});
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) },
  sqlClient: { end: vi.fn() }, dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn(),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { put: vi.fn(), get: vi.fn().mockResolvedValue(null), getOrLoad: vi.fn().mockResolvedValue([]), invalidate: vi.fn() },
  queue: {
    publish: (...a: unknown[]) => publishSpy(...a), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));
vi.mock("../src/shared/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/shared/context.js")>();
  return {
    ...original,
    resolveContext: (req: any) => {
      const ctx = req.ctx;
      if (!ctx || ctx.actorId === "system" || ctx.actorId === "anonymous") throw new original.HttpError(401, "UNAUTHENTICATED", "missing authentication");
      return { actorId: ctx.actorId, tenantId: ctx.tenantId, roles: ctx.roles ?? [], sessionId: ctx.sessionId ?? "", correlationId: ctx.correlationId ?? req.id };
    },
  };
});

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app.close(); });

const body = (amountMinor: string) => ({ assesseeId: ASSESSEE, fromDemandId: FROM, toDemandId: TO, amountMinor, reason: "move principal" });

describe("POST /v1/revenue/adjustments movable cap (owner decision #5)", () => {
  it("422s an amount above the movable principal and publishes nothing", async () => {
    publishSpy.mockClear();
    const res = await app.inject({ method: "POST", url: "/v1/revenue/adjustments", headers: AUTH, payload: body("800001") });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("ADJUSTMENT_EXCEEDS_MOVABLE");
    expect(publishSpy).not.toHaveBeenCalled();
  });
  it("accepts exactly the movable principal", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/adjustments", headers: AUTH, payload: body("800000") });
    expect(res.statusCode).toBe(202);
  });
  it("GET movable-demands returns the per-demand cap, and enforces auth/role", async () => {
    const ok = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE}/movable-demands`, headers: AUTH });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data[0]).toEqual({ demandId: FROM, outstandingMinor: "1000000", movableMinor: "800000" });
    expect((await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE}/movable-demands` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE}/movable-demands`, headers: BAD })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/revenue/assessees/not-a-uuid/movable-demands", headers: AUTH })).statusCode).toBe(400);
  });
});
