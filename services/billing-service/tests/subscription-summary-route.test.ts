/**
 * GAP-TENANT-ADMIN-SUBSCRIPTION-06 / -03: GET /v1/billing/subscriptions is the
 * caller's own-tenant summary the tenant-admin Subscription page reads.
 *  - tenant_admin (and billing_admin) may read it; it used to be super-admin
 *    only, so a tenant admin always got 403 on their own subscription page.
 *  - a "suspended" subscription is reported as "suspended", not folded into "trial".
 *  - no money amount is invented: the summary carries no `amount` field at all.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a1";
const ACTOR = "11111111-1111-4000-8000-0000000000a2";

const state = vi.hoisted(() => ({ sub: null as Record<string, unknown> | null, askedTenant: "" }));

vi.mock("../src/modules/subscriptions/queries.js", () => ({
  getSubscription: async (tenantId: string) => { state.askedTenant = tenantId; return state.sub; },
}));

let app: FastifyInstance;
const bearer = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600)}` });

beforeAll(async () => {
  const { authPlugin } = await import("@civitasone/auth/plugin");
  const { subscriptionsRoutes } = await import("../src/modules/subscriptions/routes.js");
  app = Fastify({ logger: false });
  await app.register(authPlugin);
  await app.register(subscriptionsRoutes);
  await app.ready();
});
afterAll(async () => { await app.close(); });

const row = (status: string) => ({ id: "33333333-3333-4333-8333-333333333333", tenantId: TENANT, planId: "plan-x", status, trialExpiresAt: null });

describe("GET /v1/billing/subscriptions", () => {
  it("lets a tenant_admin read their OWN tenant's subscription", async () => {
    state.sub = row("active");
    const res = await app.inject({ method: "GET", url: "/v1/billing/subscriptions?tenantId=bbbbbbbb-1111-4000-8000-0000000000b1", headers: bearer(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("active");
    expect(res.json()).not.toHaveProperty("amount");
    expect(state.askedTenant).toBe(TENANT); // never the query-string tenant
  });

  it("reports a suspended subscription as suspended, not trial", async () => {
    state.sub = row("suspended");
    const res = await app.inject({ method: "GET", url: "/v1/billing/subscriptions", headers: bearer(["billing_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("suspended");
  });

  it("keeps past_due, cancelled and trial distinct", async () => {
    for (const status of ["past_due", "cancelled", "trial"]) {
      state.sub = row(status);
      const res = await app.inject({ method: "GET", url: "/v1/billing/subscriptions", headers: bearer(["super_admin"]) });
      expect(res.json().status).toBe(status);
    }
  });

  it("403 for a role outside the billing readers, 401 without a token", async () => {
    state.sub = row("active");
    expect((await app.inject({ method: "GET", url: "/v1/billing/subscriptions", headers: bearer(["employee"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/billing/subscriptions" })).statusCode).toBe(401);
  });
});
