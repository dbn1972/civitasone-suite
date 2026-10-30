/**
 * UAT W8-D, revenue-service trade licences:
 *  - P1 accept-nonexistent: POST trade-licenses/:id/renew (untriaged row) and, from the sibling
 *    sweep, /cancel and /payment published and answered 202 for ANY well-formed id (the consumer
 *    then silently no-ops). Each now does the same tenant-scoped read as GET /:id first: random id
 *    or another tenant's licence -> 404, nothing published; a real licence -> 202, published.
 *  - P2 renew data loss: an empty renew body (or one with neither expiryDate nor renewalYear) was
 *    accepted, and the consumer then set the licence's expiry to NULL and its fee to 0. Such a
 *    body is now 400, and the licence is left untouched. Valid renew bodies are unchanged.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { tenantTransaction } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tradeLicenses } from "../src/modules/trade-license/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const LICENSE = randomUUID();
const EXPIRY = "2027-03-31";
const FEE = 250000n;
const bearer = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["revenue_admin"], sid: "sess-w8d-revenue" }, SECRET, 3600)}`,
});
const post = (path: string, id: string, payload: unknown, tenantId = TENANT) =>
  app.inject({ method: "POST", url: `/v1/revenue/trade-licenses/${id}/${path}`, headers: bearer(tenantId), payload: payload as object });

async function readLicense() {
  const rows = await tenantTransaction(db, TENANT, (tx) =>
    (tx as typeof db).select().from(tradeLicenses).where(and(eq(tradeLicenses.tenantId, TENANT), eq(tradeLicenses.id, LICENSE))));
  return rows[0]!;
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await tenantTransaction(db, TENANT, async (tx) => {
    await (tx as typeof db).insert(tradeLicenses).values({
      id: LICENSE, tenantId: TENANT, licenseNo: `W8D${LICENSE.slice(0, 8)}`, businessName: "W8D shop", proprietorName: "W8D",
      address: "1 Test Road", businessType: "retail", expiryDate: EXPIRY, feeMinor: FEE, createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await tenantTransaction(db, TENANT, (tx) =>
    (tx as typeof db).delete(tradeLicenses).where(and(eq(tradeLicenses.tenantId, TENANT), eq(tradeLicenses.id, LICENSE)))).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; path: string; topic: string; payload: Record<string, unknown> };
const cases: Case[] = [
  { name: "renew", path: "renew", topic: "revenue.trade_license.renew", payload: { renewalYear: 2028 } },
  { name: "cancel", path: "cancel", topic: "revenue.trade_license.cancel", payload: { reason: "w8d" } },
  { name: "payment", path: "payment", topic: "revenue.trade_license.payment", payload: { amountMinor: 100 } },
];

describe("UAT W8-D: trade-license commands answer 404 for a licence that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404 NOT_FOUND, nothing published`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await post(c.path, randomUUID(), c.payload);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${c.name}: another tenant's real licence -> 404 (tenant-scoped read), nothing published`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await post(c.path, LICENSE, c.payload, OTHER_TENANT);
      expect(res.statusCode).toBe(404);
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${c.name}: a real licence of this tenant -> 202 and the command is published`, async () => {
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await post(c.path, LICENSE, c.payload);
      expect(res.statusCode).toBe(202);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish.mock.calls[0]![0]).toBe(c.topic);
    });
  }

  it("body validation still runs (a malformed renew expiryDate -> 400)", async () => {
    const res = await post("renew", LICENSE, { expiryDate: "31-03-2027" });
    expect(res.statusCode).toBe(400);
  });
});

describe("UAT W8-D P2: renew needs a new expiry (empty body used to null the expiry and zero the fee)", () => {
  for (const [label, payload] of [
    ["empty body", {}],
    ["only a fee", { feeMinor: 5000 }],
    ["only unknown fields (stripped)", { id: randomUUID(), amount: 5, email: "a@b.c" }],
  ] as const) {
    it(`${label} on a real licence -> 400, nothing published, licence unchanged`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await post("renew", LICENSE, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_FAILED");
      expect(publish).not.toHaveBeenCalled();
      const row = await readLicense();
      expect(row.expiryDate).toBe(EXPIRY);
      expect(row.feeMinor).toBe(FEE);
    });
  }

  for (const [label, payload, topicExpiry] of [
    ["renewalYear", { renewalYear: 2028 }, "2028-03-31"],
    ["expiryDate + fee", { expiryDate: "2028-06-30", feeMinor: 300000 }, "2028-06-30"],
  ] as const) {
    it(`valid body (${label}) -> 202 and the renew command carries the new expiry`, async () => {
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await post("renew", LICENSE, payload);
      expect(res.statusCode).toBe(202);
      expect(publish).toHaveBeenCalledTimes(1);
      const msg = publish.mock.calls[0]![1] as { payload: Record<string, unknown> };
      expect(msg.payload.expiryDate).toBe(topicExpiry);
    });
  }
});
