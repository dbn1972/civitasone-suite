/**
 * D4c #28 (GAP-PROCUREMENT-ORDERS-NEW-06): a purchase order may go to a vendor
 * with NO empanelment record only when it is linked to an awarded tender (won by
 * that vendor) or carries a GeM order reference. Otherwise it is rejected
 * (422 VENDOR_NOT_EMPANELLED at the API; dropped + audited in the consumer).
 * Lapsed empanelment and blacklisting keep their own gates.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementVendors, procurementEmpanelment } from "../src/modules/vendor/schema.js";
import { procurementTenders } from "../src/modules/tender/schema.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const V_NONE = randomUUID();      // registered vendor, no empanelment record
const V_EMP = randomUUID();       // vendor with an active empanelment
const V_OTHER = randomUUID();     // some other vendor
const T_AWARDED = randomUUID();   // awarded to V_NONE
const T_OTHER_WINNER = randomUUID(); // awarded to V_OTHER
const T_OPEN = randomUUID();      // not awarded
const T_FOREIGN = randomUUID();   // awarded to V_NONE but in another tenant
const INDENT = randomUUID();
let app: FastifyInstance;

const hdr = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer"], sid: "s" }, SECRET, 3600)}`, "x-tenant-id": TENANT });
const items = [{ itemCode: "I1", description: "Item", quantity: 1, unit: "nos", unitPriceMinor: 10000 }];
const poBody = (vendorId: string, extra: Record<string, unknown> = {}) => ({ vendorId, indentRef: `procurement_indent:${INDENT}`, items, ...extra });
const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/procurement/pos", headers: hdr(), payload });

function tender(id: string, tenantId: string, status: string, awardedVendorId: string | null) {
  return { id, tenantId, tenderNo: `T-${id.slice(0, 8)}`, title: "t", bidClosingDate: "2026-12-31", status, awardedVendorId, createdBy: ACTOR, updatedBy: ACTOR };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const v = (id: string, name: string, tenantId = TENANT) => ({ id, tenantId, name, createdBy: ACTOR, updatedBy: ACTOR });
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values([v(V_NONE, "No Record Vendor"), v(V_EMP, "Empanelled Vendor"), v(V_OTHER, "Other Vendor")]);
    await tx.insert(procurementEmpanelment).values({ vendorId: V_EMP, tenantId: TENANT, category: "goods", empanelDate: "2026-01-01", validUntil: "2099-12-31", status: "active", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(procurementTenders).values([
      tender(T_AWARDED, TENANT, "awarded", V_NONE),
      tender(T_OTHER_WINNER, TENANT, "awarded", V_OTHER),
      tender(T_OPEN, TENANT, "published", null),
    ]);
    await tx.insert(procurementIndents).values({ id: INDENT, tenantId: TENANT, indentNo: `IND-${INDENT.slice(0, 8)}`, department: "Admin", purpose: "d4c28", totalMinor: 100000000n, committedMinor: 0n, currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR });
  }));
  await runWithTenant(OTHER_TENANT, () => db.transaction((tx) => tx.insert(procurementTenders).values(tender(T_FOREIGN, OTHER_TENANT, "awarded", V_NONE))));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, TENANT));
    await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, TENANT));
    await tx.delete(procurementEmpanelment).where(eq(procurementEmpanelment.tenantId, TENANT));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
  }));
  await runWithTenant(OTHER_TENANT, () => db.transaction((tx) => tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, OTHER_TENANT))));
  await app.close();
  await sqlClient.end();
});

describe("API gate", () => {
  it("rejects a vendor with no empanelment record and no basis (422 VENDOR_NOT_EMPANELLED)", async () => {
    const res = await post(poBody(V_NONE));
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VENDOR_NOT_EMPANELLED");
  });
  it("allows it when linked to an awarded tender won by that vendor", async () => {
    expect((await post(poBody(V_NONE, { tenderId: T_AWARDED }))).statusCode).toBe(202);
  });
  it("rejects a tender awarded to someone else, an un-awarded tender, and another tenant tender", async () => {
    for (const tenderId of [T_OTHER_WINNER, T_OPEN, T_FOREIGN, randomUUID()]) {
      const res = await post(poBody(V_NONE, { tenderId }));
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("VENDOR_NOT_EMPANELLED");
    }
  });
  it("allows it when a GeM order reference is given; a blank one does not count", async () => {
    expect((await post(poBody(V_NONE, { gemOrderRef: "GEM/2026/B/123456" }))).statusCode).toBe(202);
    expect((await post(poBody(V_NONE, { gemOrderRef: "   " }))).statusCode).toBe(422);
  });
  it("an empanelled vendor needs no basis", async () => {
    expect((await post(poBody(V_EMP))).statusCode).toBe(202);
  });
});

describe("consumer re-check (defence in depth)", () => {
  function wire(q: MemoryQueue): MemoryQueue {
    const raw = q.subscribe.bind(q);
    q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
    return q;
  }
  const msg = (id: string, vendorId: string, extra: Record<string, unknown>) => ({
    messageId: id, type: COMMANDS.poCreate, tenantId: TENANT, actorId: ACTOR, correlationId: `c-${id}`, schemaVersion: "1.0",
    payload: { id, tenantId: TENANT, poNo: `PO-${id.slice(0, 8)}`, vendorId, indentRef: `procurement_indent:${INDENT}`, items, ...extra },
  });
  const poRow = async (id: string) => (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(procurementPos).where(eq(procurementPos.id, id)))))[0];

  it("drops a PO with no basis (no row) and records the basis on one that has it", async () => {
    const q = wire(new MemoryQueue());
    registerPoConsumers(q);
    await q.start();
    const bad = randomUUID(); const viaTender = randomUUID(); const viaGem = randomUUID();
    await q.publish(COMMANDS.poCreate, msg(bad, V_NONE, {}));
    await q.publish(COMMANDS.poCreate, msg(viaTender, V_NONE, { tenderId: T_AWARDED }));
    await q.publish(COMMANDS.poCreate, msg(viaGem, V_NONE, { gemOrderRef: "GEM/1" }));
    await q.drain();
    expect(await poRow(bad)).toBeUndefined();
    expect((await poRow(viaTender))?.tenderId).toBe(T_AWARDED);
    expect((await poRow(viaGem))?.gemOrderRef).toBe("GEM/1");
  });
});
