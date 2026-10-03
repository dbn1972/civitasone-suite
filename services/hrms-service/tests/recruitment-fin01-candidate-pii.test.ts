/** Candidate-master PII policy (review fix): masked on GET, audited reveal; reveal audit failures are loud. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const TENANT = "aaaaaaaa-0001-4000-8000-00000000a001";
const CAND = "55555555-0001-4000-8000-000000000005";
const H = vi.hoisted(() => ({
  ctx: { tenantId: "aaaaaaaa-0001-4000-8000-00000000a001", actorId: "99999999-0001-4000-8000-000000000009", correlationId: "c", roles: ["hr_officer"] as string[] },
  publish: vi.fn(async () => ({ id: "x" })),
  findCandidate: vi.fn(),
  logError: vi.fn(),
  txThrows: false,
}));
vi.mock("../src/shared/context.js", async (io) => ({ ...(await io<Record<string, unknown>>()), resolveContext: () => H.ctx }));
vi.mock("../src/shared/f3-publish.js", () => ({ publishF3Write: (...a: unknown[]) => (H.publish as (...x: unknown[]) => unknown)(...a) }));
vi.mock("../src/modules/recruitment/candidate-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findCandidate: (...a: unknown[]) => H.findCandidate(...a),
  countEducation: async () => 1, countEmployment: async () => 0,
}));
vi.mock("pino", () => ({ pino: () => ({ error: (...a: unknown[]) => H.logError(...a), warn: vi.fn(), info: vi.fn() }) }));
vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => { if (H.txThrows) throw new Error("db down"); return cb({}); } },
}));
vi.mock("../src/shared/outbox.js", async (io) => ({ ...(await io<Record<string, unknown>>()), markProcessed: async () => true, enqueue: async () => undefined }));
vi.mock("../src/modules/recruitment/audit-emit.js", () => ({ emitAudit: async () => undefined }));

import { candidateRoutes } from "../src/modules/recruitment/candidate-routes.js";
import { registerRecruitmentFinishConsumers } from "../src/modules/recruitment/finish-consumer.js";
import { COMMANDS } from "../src/topics.js";

const CANDIDATE = { id: CAND, tenantId: TENANT, email: "asha@example.com", normalizedEmail: "asha@example.com", mobile: "9876543210", normalizedMobile: "9876543210", fullName: "Asha Verma", status: "draft", dateOfBirth: null, category: null, activeResumeRef: null };
beforeEach(() => { vi.clearAllMocks(); H.txThrows = false; H.ctx.roles = ["hr_officer"]; H.findCandidate.mockResolvedValue(CANDIDATE); });

describe("GET /v1/hrms/candidates/:id", () => {
  it("masks email, mobile and the normalised dedup keys (full values only via the audited reveal)", async () => {
    const app = Fastify(); await app.register(candidateRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/candidates/${CAND}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("asha@example.com");
    expect(res.body).not.toContain("9876543210");
    expect(res.json()).toMatchObject({ email: "a***@e***.com", mobile: "******3210", normalizedEmail: "a***@e***.com", normalizedMobile: "******3210", contactMasked: true, fullName: "Asha Verma" });
    await app.close();
  });
});

describe("POST /v1/hrms/candidates/:id/reveal-contact", () => {
  it("needs a reason, queues the audit command first, then returns the values", async () => {
    const app = Fastify(); await app.register(candidateRoutes);
    expect((await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CAND}/reveal-contact`, payload: { reason: "x" } })).statusCode).toBe(400);
    expect(H.publish).not.toHaveBeenCalled();
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CAND}/reveal-contact`, payload: { reason: "verify before interview call" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toEqual({ id: CAND, email: "asha@example.com", mobile: "9876543210" });
    const [, op, , p] = H.publish.mock.calls[0] as unknown as [unknown, string, string, { body: Record<string, unknown> }];
    expect(op).toBe("recruitment_pii_reveal__0");
    expect(p.body).toMatchObject({ action: "candidate_contact_revealed", scope: "candidate_profile" });
    expect(JSON.stringify(p)).not.toContain("asha@example.com");
    await app.close();
  });
  it("fails closed when the audit command cannot be queued, and 403s a non-HR role", async () => {
    const app = Fastify(); await app.register(candidateRoutes);
    H.publish.mockRejectedValueOnce(new Error("queue down"));
    const res = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CAND}/reveal-contact`, payload: { reason: "verify before interview call" } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("asha@example.com");
    H.ctx.roles = ["employee"];
    expect((await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CAND}/reveal-contact`, payload: { reason: "verify before interview call" } })).statusCode).toBe(403);
    await app.close();
  });
});

describe("reveal audit write failure is loud", () => {
  type Handler = (msg: Record<string, unknown>) => Promise<void>;
  const handlers = new Map<string, Handler>();
  registerRecruitmentFinishConsumers({ subscribe: (t: string, fn: Handler) => { handlers.set(t, fn); } } as never);
  const run = (op: string) => handlers.get(COMMANDS.f3RouteWrite)!({ messageId: "m", tenantId: TENANT, actorId: H.ctx.actorId, correlationId: "c", payload: { tenantId: TENANT, op, id: "x", params: { id: CAND }, body: { action: "candidate_contact_revealed", scope: "candidate_profile", reason: "r", fields: [] } } });

  it("logs an alert-tagged error naming the application and rethrows so the queue retries / dead-letters", async () => {
    H.txThrows = true;
    await expect(run("recruitment_pii_reveal__0")).rejects.toThrow("db down");
    const [fields, message] = H.logError.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(fields).toMatchObject({ alert: "pii_reveal_audit_failed", applicationId: CAND, tenantId: TENANT });
    expect(message).toMatch(/PII reveal audit write failed/);
  });
  it("other ops keep the ordinary log line", async () => {
    H.txThrows = true;
    await expect(run("recruitment_settings_routes__0")).rejects.toThrow();
    expect((H.logError.mock.calls[0] as unknown as [unknown, string])[1]).toBe("f3RouteWrite failed");
  });
});
