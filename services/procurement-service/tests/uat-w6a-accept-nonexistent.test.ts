/**
 * UAT W6-A (P1 accept-nonexistent): these procurement commands published without reading
 * their target, so a random id got 202. Each now does a tenant-scoped existence read first:
 * random id -> 404 and nothing published; a real row -> 202 and the command is published.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { procurementAuctions } from "../src/modules/auction/schema.js";
import { procurementPos } from "../src/modules/po/schema.js";
import { procurementTenders } from "../src/modules/tender/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const ids = { auction: randomUUID(), po: randomUUID(), tender: randomUUID(), vendor: randomUUID() };

const hdr = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["procurement_officer", "procurement_admin", "super_admin"], sid: "s" }, SECRET, 3600)}`,
  "x-tenant-id": tenant,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementAuctions).values({
      id: ids.auction, tenantId: TENANT, auctionNo: `A-W6A-${ids.auction.slice(0, 6)}`, indentRef: "x", title: "w6a", reserveMinor: 500000n,
      startAt: new Date(Date.now() - 3600_000), endAt: new Date(Date.now() + 3600_000), status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementPos).values({ id: ids.po, tenantId: TENANT, poNo: `PO/W6A/${ids.po.slice(0, 6)}`, vendorId: ids.vendor, indentRef: "x", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(procurementTenders).values({
      id: ids.tender, tenantId: TENANT, tenderNo: `TND-W6A-${ids.tender.slice(0, 6)}`, title: "w6a", type: "open", bidClosingDate: "2026-06-01",
      status: "technical_evaluation", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementVendors).values({ id: ids.vendor, tenantId: TENANT, name: "W6A Vendor", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementAuctions).where(eq(procurementAuctions.id, ids.auction));
    await tx.delete(procurementPos).where(eq(procurementPos.id, ids.po));
    await tx.delete(procurementTenders).where(eq(procurementTenders.id, ids.tender));
    await tx.delete(procurementVendors).where(eq(procurementVendors.id, ids.vendor));
  })).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; method: "POST" | "PATCH"; url: (id: string) => string; realId: () => string };
const cases: Case[] = [
  { name: "vendor scorecard recompute", method: "POST", url: (id) => `/v1/procurement/vendors/${id}/scorecard/recompute`, realId: () => ids.vendor },
  { name: "PO submit-approval", method: "POST", url: (id) => `/v1/procurement/pos/${id}/submit-approval`, realId: () => ids.po },
  { name: "auction close", method: "PATCH", url: (id) => `/v1/procurement/auctions/${id}/close`, realId: () => ids.auction },
  { name: "tender open-financial", method: "POST", url: (id) => `/v1/procurement/tenders/${id}/open-financial`, realId: () => ids.tender },
];

describe("UAT W6-A: procurement command routes answer 404 for a record that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: c.method, url: c.url(randomUUID()), headers: hdr(), payload: {} });
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: another tenant's real id -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: hdr(OTHER_TENANT), payload: {} });
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: real id -> 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      try {
        const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: hdr(), payload: {} });
        expect(res.statusCode).toBe(202);
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT });
      } finally {
        spy.mockRestore();
      }
    });
  }
});
