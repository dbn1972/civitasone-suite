/**
 * UAT W8-D (P1 accept-nonexistent): PATCH subscriptions/:id/activate|cancel and POST
 * invoices/:id/generate-irn published a command and answered 202 for ANY well-formed id.
 * Each now does a tenant-scoped existence read first: random id or another tenant's row ->
 * 404 and nothing published; a real row of the caller's tenant -> 202 and the command is
 * published (the consumer stays the race-safe authority).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { billingSubscriptions } from "../src/modules/subscriptions/schema.js";
import { billingInvoices } from "../src/modules/invoices/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const ids = { subscription: randomUUID(), invoice: randomUUID() };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
const bearer = (tenantId: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-w8d-billing" }, SECRET, 3600)}`,
});

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await asTenant(TENANT, async (tx) => {
    await tx.insert(billingSubscriptions).values({ id: ids.subscription, tenantId: TENANT, planId: randomUUID(), status: "trial", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(billingInvoices).values({ id: ids.invoice, tenantId: TENANT, periodMonth: "2026-10", createdBy: ACTOR, updatedBy: ACTOR });
  });
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await asTenant(TENANT, async (tx) => {
    await tx.delete(billingInvoices).where(eq(billingInvoices.id, ids.invoice));
    await tx.delete(billingSubscriptions).where(eq(billingSubscriptions.id, ids.subscription));
  }).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; method: "PATCH" | "POST"; url: (id: string) => string; realId: () => string; roles: string[]; payload?: Record<string, unknown> };
const cases: Case[] = [
  { name: "subscription activate", method: "PATCH", url: (id) => `/v1/billing/subscriptions/${id}/activate`, realId: () => ids.subscription, roles: ["super_admin"] },
  { name: "subscription cancel", method: "PATCH", url: (id) => `/v1/billing/subscriptions/${id}/cancel`, realId: () => ids.subscription, roles: ["super_admin"] },
  { name: "invoice generate-irn", method: "POST", url: (id) => `/v1/billing/invoices/${id}/generate-irn`, realId: () => ids.invoice, roles: ["billing_admin"] },
  // sibling sweep: cancel-irn had the same gap (202 for any id)
  { name: "invoice cancel-irn", method: "POST", url: (id) => `/v1/billing/invoices/${id}/cancel-irn`, realId: () => ids.invoice, roles: ["billing_admin"], payload: { reason: "w8d" } },
];

describe("UAT W8-D: billing command routes answer 404 for a record that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404 NOT_FOUND, nothing published`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await app.inject({ method: c.method, url: c.url(randomUUID()), headers: bearer(TENANT, c.roles), payload: c.payload ?? {} });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${c.name}: another tenant's real id -> 404 (tenant-scoped read), nothing published`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: bearer(OTHER_TENANT, c.roles), payload: c.payload ?? {} });
      expect(res.statusCode).toBe(404);
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${c.name}: a real row of this tenant -> 202 and the command is published`, async () => {
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: bearer(TENANT, c.roles), payload: c.payload ?? {} });
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("accepted");
      expect(publish).toHaveBeenCalledTimes(1);
    });
  }
});
