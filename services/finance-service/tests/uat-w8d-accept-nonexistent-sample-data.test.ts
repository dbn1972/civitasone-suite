/**
 * UAT W8-D, finance-service:
 *  - P1 accept-nonexistent: POST sanctions/:id/submit-approval and POST journals/:id/reverse
 *    published and answered 202 for ANY well-formed id (PATCH journals/:id/approve is pinned in
 *    journal-period-voucher-sync.test.ts). They now read the row tenant-scoped first: random id
 *    or another tenant's row -> 404, nothing published; a real row -> 202, published.
 *  - P7: POST/DELETE bills/sample-data (developer "try it" seeding) were live in UAT. They are
 *    dev-only now, same gate as location-service: ENABLE_SAMPLE_DATA_ROUTES=true opts in,
 *    NODE_ENV=production always refuses, a disabled route answers 404.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { bearer } from "./_fp02.js";
import { financeSanctions } from "../src/modules/budget/schema.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import * as paymentsRepo from "../src/modules/payments/repo.js";
import { isSampleDataRoutesEnabled } from "../src/modules/payments/routes.js";

// gl.finance_journals is append-only (a trigger refuses DELETE), so each run gets its own tenant.
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const ids = { sanction: randomUUID(), journal: randomUUID() };
const admin = (tenant = TENANT) => bearer(tenant, ACTOR, ["finance_admin"]);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await scoped(TENANT, async (tx) => {
    await tx.insert(financeSanctions).values({
      id: ids.sanction, tenantId: TENANT, sanctionNo: `W8D-${ids.sanction.slice(0, 8)}`, purpose: "w8d", headId: randomUUID(),
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(financeJournals).values({
      id: ids.journal, tenantId: TENANT, voucherNo: `W8D-${ids.journal}`, type: "journal", postingDate: "2026-05-10", status: "posted",
      lines: [{ accountCode: "5100", debitMinor: "100", creditMinor: "0" }, { accountCode: "1100", debitMinor: "0", creditMinor: "100" }],
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  await scoped(TENANT, (tx) => tx.delete(financeSanctions).where(eq(financeSanctions.id, ids.sanction))).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; url: (id: string) => string; realId: () => string; payload: Record<string, unknown> };
const cases: Case[] = [
  { name: "sanction submit-approval", url: (id) => `/v1/finance/sanctions/${id}/submit-approval`, realId: () => ids.sanction, payload: {} },
  { name: "journal reverse", url: (id) => `/v1/finance/journals/${id}/reverse`, realId: () => ids.journal, payload: { reason: "w8d" } },
];

describe("UAT W8-D: finance command routes answer 404 for a record that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404 NOT_FOUND, nothing published`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await app.inject({ method: "POST", url: c.url(randomUUID()), headers: admin(), payload: c.payload });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${c.name}: another tenant's real id -> 404 (tenant-scoped read), nothing published`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await app.inject({ method: "POST", url: c.url(c.realId()), headers: admin(OTHER_TENANT), payload: c.payload });
      expect(res.statusCode).toBe(404);
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${c.name}: a real row of this tenant -> 202 and the command is published`, async () => {
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: "POST", url: c.url(c.realId()), headers: admin(), payload: c.payload });
      expect(res.statusCode).toBe(202);
      expect(publish).toHaveBeenCalledTimes(1);
    });
  }

  it("sanction submit-approval: body validation still applies on a real row (fileNo must be a string)", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "POST", url: `/v1/finance/sanctions/${ids.sanction}/submit-approval`, headers: admin(), payload: { fileNo: 42 } });
    expect(res.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("UAT W8-D P7: isSampleDataRoutesEnabled (finance)", () => {
  it("is off by default", () => {
    expect(isSampleDataRoutesEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isSampleDataRoutesEnabled({ NODE_ENV: "development" })).toBe(false);
  });
  it("is on only with ENABLE_SAMPLE_DATA_ROUTES=true outside production", () => {
    expect(isSampleDataRoutesEnabled({ NODE_ENV: "development", ENABLE_SAMPLE_DATA_ROUTES: "true" })).toBe(true);
    expect(isSampleDataRoutesEnabled({ NODE_ENV: "development", ENABLE_SAMPLE_DATA_ROUTES: "1" })).toBe(false);
  });
  // Under NODE_ENV=production the HS256 test tokens are refused before any handler runs, so the
  // production behaviour is pinned on the predicate rather than injected.
  it("is always off in production, whatever the flag says", () => {
    expect(isSampleDataRoutesEnabled({ NODE_ENV: "production", ENABLE_SAMPLE_DATA_ROUTES: "true" })).toBe(false);
  });
});

describe("UAT W8-D P7: bills/sample-data routes are 404 when the dev flag is off", () => {
  for (const method of ["POST", "DELETE"] as const) {
    it(`${method} /v1/finance/bills/sample-data -> 404 and the repo is never touched (flag unset)`, async () => {
      vi.stubEnv("ENABLE_SAMPLE_DATA_ROUTES", "");
      const seed = vi.spyOn(paymentsRepo, "seedSampleBills");
      const clear = vi.spyOn(paymentsRepo, "clearSampleBills");
      const res = await app.inject({ method, url: "/v1/finance/bills/sample-data", headers: admin() });
      expect(res.statusCode).toBe(404);
      expect(seed).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
    });
  }

  it("DELETE /v1/finance/bills/sample-data -> 200 when the flag is on (dev)", async () => {
    vi.stubEnv("ENABLE_SAMPLE_DATA_ROUTES", "true");
    const clear = vi.spyOn(paymentsRepo, "clearSampleBills").mockResolvedValue(0 as never);
    const res = await app.inject({ method: "DELETE", url: "/v1/finance/bills/sample-data", headers: admin() });
    expect(res.statusCode).toBe(200);
    expect(clear).toHaveBeenCalledWith(TENANT);
  });

  it("the role check still runs first: a citizen gets 403 even with the flag off", async () => {
    vi.stubEnv("ENABLE_SAMPLE_DATA_ROUTES", "");
    const res = await app.inject({ method: "POST", url: "/v1/finance/bills/sample-data", headers: bearer(TENANT, ACTOR, ["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});
