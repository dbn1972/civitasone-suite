/**
 * GAP-LOYALTY-ACCRUALS-02 / GAP-LOYALTY-MEMBERS-02 (owner decisions D4c #14/#15, 2026-10-27):
 * the member profile id is personal data. Enrolment views carry only a shortened `profileRef`;
 * the full id is revealed solely by an audited request, to loyalty roles only.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const TENANT = crypto.randomUUID();
const ACTOR = crypto.randomUUID();
const ENROLMENT_ID = crypto.randomUUID();
const PROFILE_ID = crypto.randomUUID();

const H = vi.hoisted(() => ({
  findByIdMock: vi.fn(),
  publishMock: vi.fn(),
  enqueueMock: vi.fn(),
  markProcessedMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
  markProcessed: (...a: unknown[]) => H.markProcessedMock(...a),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: vi.fn().mockReturnValue("k") },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));
vi.mock("../src/shared/tenant-queue.js", () => ({ tenantScoped: (q: unknown) => q }));

const repoActual = await vi.importActual<typeof import("../src/modules/enrolments/repo.js")>("../src/modules/enrolments/repo.js");
vi.mock("../src/modules/enrolments/repo.js", async (orig) => {
  const actual = await orig<typeof import("../src/modules/enrolments/repo.js")>();
  return { ...actual, findById: (...a: unknown[]) => H.findByIdMock(...a) };
});

const { buildApp } = await import("../src/app.js");
const { registerEnrolmentConsumers } = await import("../src/modules/enrolments/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const token = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}` });

function row() {
  return {
    id: ENROLMENT_ID, tenantId: TENANT, programId: crypto.randomUUID(), profileId: PROFILE_ID,
    status: "active", tier: "base", pointsBalance: 5n, lifetimePoints: 9n, enrolledAt: new Date(),
    createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR, version: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.findByIdMock.mockResolvedValue(row());
  H.publishMock.mockResolvedValue(undefined);
  H.markProcessedMock.mockResolvedValue(true);
});

describe("enrolment view", () => {
  it("carries a shortened profileRef and never the full profile id", () => {
    const v = repoActual.toView(row() as never) as Record<string, unknown>;
    expect(v.profileRef).toBe(PROFILE_ID.slice(0, 8));
    expect(v).not.toHaveProperty("profileId");
    expect(JSON.stringify(v)).not.toContain(PROFILE_ID);
  });

  it("GET /v1/loyalty/enrolments/:id does not leak the full id", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/loyalty/enrolments/${ENROLMENT_ID}`, headers: token(["loyalty_user"]) });
    await app.close();
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(PROFILE_ID);
    expect(r.json().data.profileRef).toBe(PROFILE_ID.slice(0, 8));
  });
});

describe("GET /v1/loyalty/enrolments/:id/profile-ref (audited reveal)", () => {
  const url = `/v1/loyalty/enrolments/${ENROLMENT_ID}/profile-ref`;

  it("returns the full id to a loyalty role AFTER the reveal audit is published", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: token(["loyalty_user"]) });
    await app.close();
    expect(r.statusCode).toBe(200);
    expect(r.json().data.profileId).toBe(PROFILE_ID);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic, msg] = H.publishMock.mock.calls[0] as [string, { payload: Record<string, unknown>; actorId: string }];
    expect(topic).toBe(COMMANDS.revealEnrolmentProfile);
    expect(msg.actorId).toBe(ACTOR);
    expect(msg.payload.enrolmentId).toBe(ENROLMENT_ID);
    expect(JSON.stringify(msg)).not.toContain(PROFILE_ID);
  });

  it("fails closed (503, no id) when the audit cannot be published", async () => {
    H.publishMock.mockRejectedValue(new Error("queue down"));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: token(["loyalty_user"]) });
    await app.close();
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain(PROFILE_ID);
    expect(r.body).not.toContain("queue down");
  });

  it("403 for a non-loyalty role, and nothing is audited or revealed", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: token(["employee"]) });
    await app.close();
    expect(r.statusCode).toBe(403);
    expect(H.publishMock).not.toHaveBeenCalled();
    expect(r.body).not.toContain(PROFILE_ID);
  });

  it("404 for an enrolment outside the tenant / missing, with no audit", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: token(["loyalty_user"]) });
    await app.close();
    expect(r.statusCode).toBe(404);
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});

describe("reveal-audit consumer", () => {
  function handlerFor(topic: string) {
    const handlers = new Map<string, (m: unknown) => Promise<void>>();
    registerEnrolmentConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => handlers.set(t, h) } as never);
    return handlers.get(topic)!;
  }
  const msg = () => ({
    messageId: crypto.randomUUID(), tenantId: TENANT, actorId: ACTOR, correlationId: crypto.randomUUID(),
    payload: { enrolmentId: ENROLMENT_ID, roles: ["loyalty_user"] },
  });

  it("writes one audit event (id only, never the value) in the same transaction as markProcessed", async () => {
    await handlerFor(COMMANDS.revealEnrolmentProfile)(msg());
    expect(H.markProcessedMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    const ev = H.enqueueMock.mock.calls[0]![1] as { topic: string; payload: Record<string, unknown> };
    expect(ev.topic).toBe("audit.event.record");
    expect(ev.payload.action).toBe("enrolment.reveal_profile_id");
    expect(ev.payload.resourceId).toBe(ENROLMENT_ID);
    expect(JSON.stringify(ev)).not.toContain(PROFILE_ID);
  });

  it("is idempotent on redelivery (no second audit row)", async () => {
    H.markProcessedMock.mockResolvedValue(false);
    await handlerFor(COMMANDS.revealEnrolmentProfile)(msg());
    expect(H.enqueueMock).not.toHaveBeenCalled();
  });
});
