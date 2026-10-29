/**
 * UAT DB read/write sweep 2026-10-28 (g4-procurement) -- regression tests for defects D1-D7.
 * Runs against the real procurement_svc role (FORCE RLS binding) via DATABASE_URL.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { vendorBlacklist } from "../src/modules/vendor-blacklist/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { procurementDebitNotes } from "../src/modules/payments/schema.js";
import { procurementPos } from "../src/modules/po/schema.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { procurementAuctions, procurementBids } from "../src/modules/auction/schema.js";
import { threeWayMatch } from "../src/modules/three-way-match/schema.js";
import * as twmRepo from "../src/modules/three-way-match/repo.js";
import * as poRepo from "../src/modules/po/repo.js";
import * as blRepo from "../src/modules/vendor-blacklist/repo.js";
import { registerVendorBlacklistConsumers } from "../src/modules/vendor-blacklist/consumer.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { registerPoAmendmentConsumers } from "../src/modules/po/amendment-consumer.js";
import { registerAuctionConsumers } from "../src/modules/auction/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { resetPiiKeyCache } from "../src/shared/pii-crypto.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000d4";
const ACTOR = "5e7cacc0-0000-4000-8000-0000000000d4";
const OTHER_ACTOR = "5e7cacc0-0000-4000-8000-0000000000d5";
const headers = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles: ["super_admin"], sid: "sess-g4" }, SECRET, 3600)}` };

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
function env(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: T, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}
const tx = <R>(fn: (t: any) => Promise<R>) => runWithTenant(T, () => db.transaction(fn));

let app: FastifyInstance;
beforeAll(async () => {
  process.env.PII_ENC_KEY = "test_pii_encryption_key_32chars!!";
  process.env.PII_KEY_ID = "k1";
  resetPiiKeyCache();
  app = await buildApp();
});
afterAll(async () => {
  await tx(async (t) => {
    await t.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, T));
    await t.delete(procurementBids).where(eq(procurementBids.tenantId, T));
    await t.delete(procurementAuctions).where(eq(procurementAuctions.tenantId, T));
    await t.delete(procurementDebitNotes).where(eq(procurementDebitNotes.tenantId, T));
    await t.delete(procurementPos).where(eq(procurementPos.tenantId, T));
    await t.delete(procurementIndents).where(eq(procurementIndents.tenantId, T));
    await t.delete(procurementVendors).where(eq(procurementVendors.tenantId, T));
  });
  await app.close();
  await sqlClient.end();
});

describe("D1: central debarments for distinct PANs are all stored", () => {
  it("stores 2 distinct PANs, dedupes the same PAN", async () => {
    const q = wire(new MemoryQueue());
    registerVendorBlacklistConsumers(q);
    await q.start();
    const base = { tenantId: T, reason: "CVC order", blacklistedFrom: "2026-01-01" };
    for (const pan of ["AAAPA1111A", "BBBPB2222B", "AAAPA1111A"]) {
      await q.publish(COMMANDS.vendorCentralDebar, env(COMMANDS.vendorCentralDebar, { ...base, id: randomUUID(), pan }));
    }
    await q.drain();
    const rows = await tx((t) => t.select().from(vendorBlacklist).where(and(eq(vendorBlacklist.tenantId, T), eq(vendorBlacklist.scope, "central"), eq(vendorBlacklist.status, "active"))));
    expect(rows.map((r: any) => r.pan).sort()).toEqual(["AAAPA1111A", "BBBPB2222B"]);
  });

  it("the DB still forbids two ACTIVE central rows for one PAN, and two active tenant rows for one vendor", async () => {
    const mk = (vendorId: string, scope: string, pan: string | null) => tx((t) => blRepo.insertBlacklistTx(t, {
      tenantId: T, vendorId, scope, pan, reason: "x", blacklistedBy: ACTOR, createdBy: ACTOR, status: "active",
    }));
    const nil = "00000000-0000-0000-0000-000000000000";
    await expect(mk(nil, "central", "AAAPA1111A")).rejects.toThrow();
    const v = randomUUID();
    await mk(v, "tenant", null);
    await expect(mk(v, "tenant", null)).rejects.toThrow();
  });
});

describe("D1 migration: two tenants already holding an active central row for one PAN", () => {
  it("0046 still applies fully (idempotent) and keeps both legal records", async () => {
    const T2 = "5e7c0000-0000-4000-8000-0000000000e4";
    const nil = "00000000-0000-0000-0000-000000000000";
    await sqlClient.unsafe("DROP INDEX IF EXISTS procurement.uq_vendor_blacklist_central_pan_active");
    const seed = (tenant: string) => runWithTenant(tenant, () => db.transaction((t) => blRepo.insertBlacklistTx(t, {
      tenantId: tenant, vendorId: nil, scope: "central", pan: "DUPPA9999D", reason: "pre-0040 central row",
      blacklistedBy: ACTOR, createdBy: ACTOR, status: "active",
    })));
    await seed(T); await seed(T2);
    try {
      const file = readFileSync(join(__dirname, "../migrations/0046_uat_g4_procurement_defects.sql"), "utf8");
      await sqlClient.unsafe(file);
      await sqlClient.unsafe(file); // idempotent
      const idx = await sqlClient`SELECT 1 FROM pg_indexes WHERE schemaname = 'procurement' AND indexname = 'uq_vendor_blacklist_central_pan_active'`;
      expect(idx).toHaveLength(1);
      const cols = await sqlClient`SELECT 1 FROM information_schema.columns WHERE table_schema = 'procurement' AND table_name = 'three_way_match' AND column_name = 'tolerance_pct'`;
      expect(cols).toHaveLength(1);
      for (const tenant of [T, T2]) {
        const rows = await runWithTenant(tenant, () => db.transaction((t) => t.select().from(vendorBlacklist).where(and(eq(vendorBlacklist.tenantId, tenant), eq(vendorBlacklist.pan, "DUPPA9999D")))));
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe("active");
      }
    } finally {
      for (const tenant of [T, T2]) {
        await runWithTenant(tenant, () => db.transaction((t) => t.delete(vendorBlacklist).where(and(eq(vendorBlacklist.tenantId, tenant), eq(vendorBlacklist.pan, "DUPPA9999D")))));
      }
    }
  });
});

describe("D2: debit note created through the consumer is stored", () => {
  it("persists status 'issued' (was rejected by the 0015 CHECK)", async () => {
    const q = wire(new MemoryQueue());
    registerPaymentsConsumers(q);
    await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.debitNoteCreate, env(COMMANDS.debitNoteCreate, {
      id, tenantId: T, grnRef: "procurement_grn:" + randomUUID(), vendorId: randomUUID(), amountMinor: 12345, reason: "short supply",
    }));
    await q.drain();
    const [row] = await tx((t) => t.select().from(procurementDebitNotes).where(eq(procurementDebitNotes.id, id)));
    expect(row?.status).toBe("issued");
  });
});

describe("D3: three_way_match model and table agree; reads do not 500", () => {
  it("every column the Drizzle model declares exists in the table", async () => {
    const declared = Object.values(getTableColumns(threeWayMatch)).map((c) => c.name).sort();
    const rows = await sqlClient`SELECT column_name FROM information_schema.columns WHERE table_schema = 'procurement' AND table_name = 'three_way_match'`;
    const actual = new Set(rows.map((r: any) => r.column_name));
    expect(declared.filter((c) => !actual.has(c))).toEqual([]);
  });

  it("list, find-by-id and the HTTP reads answer without a 500", async () => {
    expect(await runWithTenant(T, () => twmRepo.listByTenant(T, undefined, 10, 0))).toEqual(expect.any(Array));
    expect(await runWithTenant(T, () => twmRepo.findMatchById(randomUUID(), T))).toBeNull();
    const list = await app.inject({ method: "GET", url: "/v1/procurement/three-way-match", headers });
    expect(list.statusCode).toBe(200);
    const inv = await app.inject({ method: "POST", url: "/v1/procurement/matches/invoice", headers, payload: { matchId: randomUUID(), invoiceRef: "INV-1" } });
    expect(inv.statusCode).toBeLessThan(500);
  });
});

describe("D4: closing a PO records closed_at and the closure note", () => {
  it("sets closedAt + closureReason", async () => {
    const id = randomUUID();
    await tx((t) => poRepo.insertPo(t, { id, tenantId: T, poNo: "PO/UAT/D4", vendorId: randomUUID(), indentRef: "x", status: "approved", createdBy: ACTOR, updatedBy: ACTOR }));
    const q = wire(new MemoryQueue());
    registerPoAmendmentConsumers(q);
    await q.start();
    await q.publish(COMMANDS.poClose, env(COMMANDS.poClose, { poId: id, tenantId: T, notes: "delivered in full" }));
    await q.drain();
    const [row] = await tx((t) => t.select().from(procurementPos).where(eq(procurementPos.id, id)));
    expect(row.status).toBe("closed");
    expect(row.closedAt).toBeInstanceOf(Date);
    expect(row.closureReason).toBe("delivered in full");
  });
});

describe("D5: bids are only accepted on an active auction inside its window", () => {
  async function mkAuction(over: Record<string, unknown> = {}) {
    const id = randomUUID();
    await tx((t) => t.insert(procurementAuctions).values({
      id, tenantId: T, auctionNo: "A-" + id.slice(0, 6), indentRef: "x", title: "t", reserveMinor: 500000n,
      startAt: new Date(Date.now() - 3600_000), endAt: new Date(Date.now() + 3600_000), status: "active",
      createdBy: ACTOR, updatedBy: ACTOR, ...over,
    }));
    return id;
  }
  const bid = (auctionId: string) => app.inject({ method: "POST", url: `/v1/procurement/auctions/${auctionId}/bids`, headers, payload: { vendorId: randomUUID(), bidMinor: 1000 } });

  it("202 while active; 409 after the auction is closed; 404 for an unknown auction", async () => {
    const id = await mkAuction();
    expect((await bid(id)).statusCode).toBe(202);
    const q = wire(new MemoryQueue());
    registerAuctionConsumers(q);
    await q.start();
    await q.publish(COMMANDS.auctionClose, env(COMMANDS.auctionClose, { id, tenantId: T }));
    await q.drain();
    const res = await bid(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("AUCTION_NOT_ACTIVE");
    expect((await bid(randomUUID())).statusCode).toBe(404);
  });

  it("409 outside the bidding window", async () => {
    const ended = await mkAuction({ startAt: new Date(Date.now() - 7200_000), endAt: new Date(Date.now() - 3600_000) });
    expect((await bid(ended)).json().code).toBe("AUCTION_ENDED");
    const future = await mkAuction({ startAt: new Date(Date.now() + 3600_000), endAt: new Date(Date.now() + 7200_000) });
    expect((await bid(future)).json().code).toBe("AUCTION_NOT_STARTED");
  });

  it("consumer never stores a bid that raced a close", async () => {
    const id = await mkAuction({ status: "closed" });
    const q = wire(new MemoryQueue());
    registerAuctionConsumers(q);
    await q.start();
    await q.publish(COMMANDS.bidSubmit, env(COMMANDS.bidSubmit, { id: randomUUID(), auctionId: id, tenantId: T, vendorId: randomUUID(), bidMinor: 1, isMse: false }));
    await q.drain();
    const rows = await tx((t) => t.select().from(procurementBids).where(eq(procurementBids.auctionId, id)));
    expect(rows).toHaveLength(0);
  });
});

describe("D6: dispatching a PO that is unknown or not approved is rejected synchronously", () => {
  it("PATCH /pos/:id/dispatch: 404 unknown PO, 409 when not approved, 202 when approved", async () => {
    expect((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${randomUUID()}/dispatch`, headers, payload: {} })).statusCode).toBe(404);
    const mk = async (status: string) => {
      const id = randomUUID();
      await tx((t) => poRepo.insertPo(t, { id, tenantId: T, poNo: "PO/UAT/D6-" + id.slice(0, 5), vendorId: randomUUID(), indentRef: "x", status, createdBy: OTHER_ACTOR, updatedBy: OTHER_ACTOR }));
      return id;
    };
    const draft = await mk("draft");
    const res = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${draft}/dispatch`, headers, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PO_NOT_APPROVED");
    const approved = await mk("approved");
    expect((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${approved}/dispatch`, headers, payload: {} })).statusCode).toBe(202);
  });
});

describe("D7: reinstating a vendor clears the blacklist reason", () => {
  it("blacklistReason is NULL after reinstate", async () => {
    const vendorId = randomUUID();
    await tx((t) => t.insert(procurementVendors).values({ id: vendorId, tenantId: T, name: "UAT D7 vendor", createdBy: ACTOR, updatedBy: ACTOR } as any));
    const q = wire(new MemoryQueue());
    registerVendorBlacklistConsumers(q);
    await q.start();
    await q.publish(COMMANDS.vendorBlacklistAdd, env(COMMANDS.vendorBlacklistAdd, { id: randomUUID(), tenantId: T, vendorId, reason: "fraud", blacklistedFrom: "2026-01-01" }));
    await q.drain();
    const [mid] = await tx((t) => t.select().from(procurementVendors).where(eq(procurementVendors.id, vendorId)));
    expect(mid.blacklistReason).toBe("fraud");
    await q.publish(COMMANDS.vendorBlacklistReinstate, env(COMMANDS.vendorBlacklistReinstate, { id: randomUUID(), tenantId: T, vendorId }));
    await q.drain();
    const [after] = await tx((t) => t.select().from(procurementVendors).where(eq(procurementVendors.id, vendorId)));
    expect(after.vendorType).toBe("registered");
    expect(after.blacklistReason).toBeNull();
    void sql;
  });
});
