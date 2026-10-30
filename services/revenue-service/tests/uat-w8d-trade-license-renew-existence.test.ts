/**
 * UAT W8-D (untriaged -> P1 accept-nonexistent): POST /v1/revenue/trade-licenses/:id/renew
 * published and answered 202 for ANY well-formed id (the consumer then silently no-ops). The
 * route now does the same tenant-scoped read as GET /:id first: random id or another tenant's
 * licence -> 404, nothing published; a real licence -> 202, published.
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
const bearer = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["revenue_admin"], sid: "sess-w8d-revenue" }, SECRET, 3600)}`,
});
const renew = (id: string, tenantId = TENANT) =>
  app.inject({ method: "POST", url: `/v1/revenue/trade-licenses/${id}/renew`, headers: bearer(tenantId), payload: { renewalYear: 2027 } });

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await tenantTransaction(db, TENANT, async (tx) => {
    await (tx as typeof db).insert(tradeLicenses).values({
      id: LICENSE, tenantId: TENANT, licenseNo: `W8D${LICENSE.slice(0, 8)}`, businessName: "W8D shop", proprietorName: "W8D",
      address: "1 Test Road", businessType: "retail", createdBy: ACTOR, updatedBy: ACTOR,
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

describe("UAT W8-D: POST /v1/revenue/trade-licenses/:id/renew answers 404 for a licence that does not exist", () => {
  it("random id -> 404 NOT_FOUND, nothing published", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await renew(randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    expect(publish).not.toHaveBeenCalled();
  });

  it("another tenant's real licence -> 404 (tenant-scoped read), nothing published", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await renew(LICENSE, OTHER_TENANT);
    expect(res.statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });

  it("a real licence of this tenant -> 202 and the renew command is published", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await renew(LICENSE);
    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toBe("revenue.trade_license.renew");
  });

  it("body validation still runs (a malformed expiryDate -> 400)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/revenue/trade-licenses/${LICENSE}/renew`, headers: bearer(), payload: { expiryDate: "31-03-2027" },
    });
    expect(res.statusCode).toBe(400);
  });
});
