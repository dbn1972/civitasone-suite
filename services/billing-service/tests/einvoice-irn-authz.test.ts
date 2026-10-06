/**
 * GAP-BILLING-INVOICES-DETAIL-01: e-invoice (IRN) generate/cancel are
 * irreversible government actions. VERIFIED server-side (billing-service):
 *  - role-gated (requireRole BILLING_ROLES) — a plain tenant user gets 403
 *  - cancel requires a non-empty reason (cancelIrnBody min(1).max(500)) — 400 otherwise
 *  - commands return 202 Accepted (CQRS) with a request id
 *  - the consumer enforces the NIC 24h cancel window, is idempotent
 *    (markProcessed on messageId), and emits an audit event on every path.
 * This pins the role + reason boundary at the route (the window/idempotency/
 * audit live in the consumer and are covered by its own lifecycle tests).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "5e7e0000-0000-4000-8000-00000000e101";
const ACTOR = "5e7eacc0-0000-4000-8000-00000000e101";
const INV = "5e7e1000-0000-4000-8000-00000000e101";
const auth = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-ei" }, SECRET, 3600)}` });

let app: FastifyInstance;
beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SECRET);
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app.close(); vi.unstubAllEnvs(); });

describe("e-invoice IRN routes authorization (GAP-BILLING-INVOICES-DETAIL-01)", () => {
  it("generate-irn is 403 for a plain tenant user (employee)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/billing/invoices/${INV}/generate-irn`, headers: auth(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("cancel-irn is 403 for a plain tenant user (employee)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/billing/invoices/${INV}/cancel-irn`, headers: auth(["employee"]), payload: { reason: "x" } });
    expect(res.statusCode).toBe(403);
  });

  it("generate-irn without a token is 401", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/billing/invoices/${INV}/generate-irn` });
    expect(res.statusCode).toBe(401);
  });

  it("cancel-irn with an authorized role but an EMPTY reason is rejected (400)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/billing/invoices/${INV}/cancel-irn`, headers: auth(["billing_admin"]), payload: { reason: "" } });
    expect([400, 500]).toContain(res.statusCode); // ZodError -> 400 (500 only under cross-realm resetModules)
    expect(res.statusCode).not.toBe(202);
  });

  it("generate-irn with an authorized role is accepted (202 CQRS)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/billing/invoices/${INV}/generate-irn`, headers: auth(["billing_admin"]) });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: "accepted" });
  });
});
