/**
 * GET /v1/plans must return the tenant's plans. plans.plans is FORCE-RLS'd and the
 * old list route used a bare db.select() (no tenant GUC) so it returned [] even
 * when rows existed (/admin/plan-pricing looked empty).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { plans } from "../src/modules/plans/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const bearer = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["tenant_admin"], sid: "sess-plans-list" }, SECRET, 3600)}` });
let app: FastifyInstance;

async function cleanup(t: string) {
  await runWithTenant(t, () => db.transaction((tx) => tx.delete(plans).where(eq(plans.tenantId, t))));
}

describe("GET /v1/plans under FORCE RLS", () => {
  beforeAll(async () => {
    app = await buildApp();
    await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.insert(plans).values({
      id: randomUUID(), tenantId: TENANT_A, code: "LISTRLS", name: "List RLS", edition: "psu",
      maxUsers: 10, maxStorageGb: 5, enabledModules: ["finance"], priceMinor: 100n,
      billingCycle: "annual", createdBy: ACTOR, updatedBy: ACTOR,
    })));
  });
  afterAll(async () => { await cleanup(TENANT_A); await cleanup(TENANT_B); await app.close(); });

  it("returns the tenant's plans (not [])", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plans", headers: bearer(TENANT_A) });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((p: { code: string }) => p.code)).toContain("LISTRLS");
  });

  it("does not leak to another tenant", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plans", headers: bearer(TENANT_B) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
