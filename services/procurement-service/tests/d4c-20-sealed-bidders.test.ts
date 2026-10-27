/**
 * D4c #20 (GAP-PROCUREMENT-TENDERS-DETAIL-04): before bids are opened, only the
 * bid-opening committee may see WHICH vendors have bid, and that view is audited.
 * For everyone else the API omits the vendor identity (name AND vendor id) until
 * the tender moves past "published" (GFR / CVC sealed-bid confidentiality).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { procurementTenders, procurementTenderBids } from "../src/modules/tender/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const T_SEALED = randomUUID();
const T_OPENED = randomUUID();
const VENDOR_A = randomUUID();
const VENDOR_B = randomUUID();
let app: FastifyInstance;
const hdr = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600)}`, "x-tenant-id": TENANT });
const get = (url: string, roles: string[]) => app.inject({ method: "GET", url, headers: hdr(roles) });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const t = (id: string, no: string, status: string) => ({ id, tenantId: TENANT, tenderNo: no, title: no, type: "open", bidClosingDate: "2026-06-01", status, createdBy: ACTOR, updatedBy: ACTOR });
  const b = (tenderId: string, vendorId: string, name: string) => ({ id: randomUUID(), tenderId, tenantId: TENANT, vendorId, vendorName: name, status: "submitted", createdBy: ACTOR, updatedBy: ACTOR });
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementTenders).values([t(T_SEALED, "TND-D4C20-S", "published"), t(T_OPENED, "TND-D4C20-O", "technical_evaluation")]);
    await tx.insert(procurementTenderBids).values([
      b(T_SEALED, VENDOR_A, "Alpha Traders"), b(T_SEALED, VENDOR_B, "Beta Works"),
      b(T_OPENED, VENDOR_A, "Alpha Traders"),
    ]);
  }));
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementTenderBids).where(eq(procurementTenderBids.tenantId, TENANT));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

const identities = (json: { bids: Array<{ vendorId?: string; vendorName?: string }> }) => json.bids.flatMap((b) => [b.vendorId, b.vendorName]);

describe("tender detail before opening", () => {
  for (const roles of [["procurement_officer"], ["procurement_admin", "super_admin"], ["audit_officer"], ["finance_officer"]]) {
    it(`omits vendor identity for ${roles.join("+")} (bid count still visible)`, async () => {
      const res = await get(`/v1/procurement/tenders/${T_SEALED}`, roles);
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.bids).toHaveLength(2);
      const flat = JSON.stringify(json);
      expect(flat).not.toContain("Alpha Traders");
      expect(flat).not.toContain("Beta Works");
      expect(flat).not.toContain(VENDOR_A);
      expect(flat).not.toContain(VENDOR_B);
      // numbering follows submission order (ties broken by bid id), so compare as a set
      expect(json.bids.map((x: { vendorName: string }) => x.vendorName).sort()).toEqual(["Bidder 1", "Bidder 2"]);
      // the bid row stays addressable for evaluation
      expect(json.bids.every((x: { bidId?: string }) => typeof x.bidId === "string")).toBe(true);
    });
  }

  it("the bid-opening committee sees the vendors, and that view is audited (no bidder names in the audit)", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue("m");
    const res = await get(`/v1/procurement/tenders/${T_SEALED}`, ["bid_opening_committee", "procurement_officer"]);
    expect(res.statusCode).toBe(200);
    expect(identities(res.json())).toEqual(expect.arrayContaining([VENDOR_A, VENDOR_B, "Alpha Traders", "Beta Works"]));
    const audits = spy.mock.calls.filter(([topic]) => topic === "audit.event.record");
    expect(audits).toHaveLength(1);
    const env = audits[0]![1] as { actorId: string; payload: Record<string, unknown> };
    expect(env.actorId).toBe(ACTOR);
    expect(env.payload).toMatchObject({ service: "procurement", action: "tender_bidders_view", resourceType: "tender", resourceId: T_SEALED });
    expect(JSON.stringify(env.payload)).not.toContain("Alpha Traders");
  });

  it("fails closed: if the audit cannot be recorded the committee gets no identities", async () => {
    vi.spyOn(queue, "publish").mockRejectedValue(new Error("down"));
    const res = await get(`/v1/procurement/tenders/${T_SEALED}`, ["bid_opening_committee", "procurement_officer"]);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.body).not.toContain("Alpha Traders");
  });
});

describe("after opening", () => {
  it("every reader role sees the vendors, with no extra audit", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue("m");
    const res = await get(`/v1/procurement/tenders/${T_OPENED}`, ["procurement_officer"]);
    expect(res.statusCode).toBe(200);
    expect(identities(res.json())).toEqual([VENDOR_A, "Alpha Traders"]);
    expect(spy.mock.calls.filter(([t]) => t === "audit.event.record")).toHaveLength(0);
  });
});

describe("evaluation view", () => {
  it("omits vendor identity before opening for non-committee roles, shows it to the committee and after opening", async () => {
    const hidden = await get(`/v1/procurement/tenders/${T_SEALED}/evaluation`, ["procurement_admin"]);
    expect(hidden.statusCode).toBe(200);
    expect(hidden.body).not.toContain("Alpha Traders");
    expect(hidden.body).not.toContain(VENDOR_A);
    vi.spyOn(queue, "publish").mockResolvedValue("m");
    const seen = await get(`/v1/procurement/tenders/${T_SEALED}/evaluation`, ["bid_opening_committee", "procurement_admin"]);
    expect(seen.body).toContain("Alpha Traders");
    const opened = await get(`/v1/procurement/tenders/${T_OPENED}/evaluation`, ["procurement_admin"]);
    expect(opened.body).toContain("Alpha Traders");
  });
});
