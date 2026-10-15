/**
 * Wave 2 procurement part 2 - vendor backend:
 *  VENDORS-03   list carries vendorType/blacklisted (they were stripped by the
 *               response schema); /vendors/summary returns whole-tenant counts.
 *  VENDORS-NEW-02 / NEW-06  server-side GSTIN integrity (state, check digit,
 *               PAN match) and duplicate GSTIN/PAN rejection (409 + consumer
 *               re-check).
 *  VENDORS-DETAIL-04  detail carries the empanelment validity.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? `${randomUUID()}${randomUUID()}`; // generated at runtime (no literal key)
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { procurementVendors, procurementEmpanelment } from "../src/modules/vendor/schema.js";
import { registerVendorConsumers } from "../src/modules/vendor/consumer.js";
import { createVendorBodyChecked } from "../src/modules/vendor/validators.js";
import { isGstinChecksumValid } from "../src/modules/vendor/gstin.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const TENANT = "11111111-eeee-4000-8000-0000000000c2";
const OTHER_TENANT = "11111111-eeee-4000-8000-0000000000c3";
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET as string;

/** Build a GSTIN with a correct check digit for the given state + PAN. */
function gstinFor(pan: string, state = "27"): string {
  const stem = `${state}${pan}1Z`;
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const c of alphabet) if (isGstinChecksumValid(stem + c)) return stem + c;
  throw new Error("no check digit");
}

const GSTIN_A = gstinFor("AABCT1234A");
const GSTIN_B = gstinFor("AABCT9999B");

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

let app: FastifyInstance;
let queue: Queue;
const headers = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["procurement_officer"], sid: "s-w2v" }, SECRET)}`,
  "content-type": "application/json",
});

async function wipe() {
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(procurementEmpanelment).where(eq(procurementEmpanelment.tenantId, t));
      await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, t));
    }));
  }
}
async function seedVendor(tenant: string, v: Partial<typeof procurementVendors.$inferInsert> & { name: string }) {
  const id = v.id ?? randomUUID();
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values({ id, tenantId: tenant, createdBy: ACTOR, updatedBy: ACTOR, ...v });
  }));
  return id;
}
async function create(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/procurement/vendors", headers: headers(), payload: body });
}

beforeAll(async () => {
  app = await buildApp();
  queue = wire(new MemoryQueue() as unknown as Queue);
  registerVendorConsumers(queue);
  await queue.start();
  await wipe();
});
afterAll(async () => { await wipe(); await queue.stop(); await app.close(); await sqlClient.end(); });

describe("VENDORS-03: list status + whole-tenant summary", () => {
  it("emits vendorType and blacklisted on the list, and counts every status in /summary", async () => {
    await seedVendor(TENANT, { name: "S Registered", vendorType: "registered" });
    await seedVendor(TENANT, { name: "S Empanelled", vendorType: "empanelled" });
    await seedVendor(TENANT, { name: "S Empanelled 2", vendorType: "empanelled" });
    await seedVendor(TENANT, { name: "S Blacklisted", vendorType: "blacklisted" });
    await seedVendor(OTHER_TENANT, { name: "Other tenant vendor", vendorType: "empanelled" });

    const list = await app.inject({ method: "GET", url: "/v1/procurement/vendors?limit=1", headers: headers() });
    expect(list.statusCode).toBe(200);
    // limit=1 -> the page is capped, but the summary must still see everything.
    expect(list.json().data).toHaveLength(1);
    expect(["registered", "empanelled", "blacklisted"]).toContain(list.json().data[0].vendorType);

    const all = await app.inject({ method: "GET", url: "/v1/procurement/vendors", headers: headers() });
    const byName = Object.fromEntries(all.json().data.map((v: { name: string }) => [v.name, v]));
    expect(byName["S Blacklisted"]).toMatchObject({ vendorType: "blacklisted", blacklisted: true });
    expect(byName["S Empanelled"]).toMatchObject({ vendorType: "empanelled", blacklisted: false });

    const sum = await app.inject({ method: "GET", url: "/v1/procurement/vendors/summary", headers: headers() });
    expect(sum.statusCode).toBe(200);
    expect(sum.json().data).toEqual({ total: 4, empanelled: 2, registered: 1, blacklisted: 1 });
  });

  it("refuses /summary to a role without read access", async () => {
    const bad = signToken({ sub: ACTOR, tid: TENANT, roles: ["citizen"], sid: "s" }, SECRET);
    const res = await app.inject({ method: "GET", url: "/v1/procurement/vendors/summary", headers: { authorization: `Bearer ${bad}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("VENDORS-NEW-02: server-side GSTIN integrity", () => {
  it("accepts a valid GSTIN and rejects a flipped check digit", () => {
    expect(createVendorBodyChecked.safeParse({ name: "V", gstin: "27AAPFU0939F1ZV" }).success).toBe(true);
    const bad = createVendorBodyChecked.safeParse({ name: "V", gstin: "27AAPFU0939F1ZW" });
    expect(bad.success).toBe(false);
  });
  it("rejects an out-of-range state code and a PAN that disagrees with the GSTIN", () => {
    const badState = gstinFor("AAPFU0939F", "50");
    expect(createVendorBodyChecked.safeParse({ name: "V", gstin: badState }).success).toBe(false);
    const mismatch = createVendorBodyChecked.safeParse({ name: "V", gstin: "27AAPFU0939F1ZV", pan: "ZZZZZ9999Z" });
    expect(mismatch.success).toBe(false);
    expect(createVendorBodyChecked.safeParse({ name: "V", gstin: "27AAPFU0939F1ZV", pan: "AAPFU0939F" }).success).toBe(true);
  });
  it("POST returns 400 for a bad check digit", async () => {
    const res = await create({ name: "Bad GSTIN Co", gstin: GSTIN_A.slice(0, 14) + (GSTIN_A.endsWith("0") ? "1" : "0") });
    expect(res.statusCode).toBe(400);
  });
});

describe("VENDORS-NEW-02 / NEW-06: duplicate GSTIN / PAN", () => {
  it("returns 409 VENDOR_DUPLICATE with the existing vendor when the GSTIN is already registered", async () => {
    const existing = await seedVendor(TENANT, { name: "Existing GSTIN Co", gstin: GSTIN_A });
    const res = await create({ name: "Same GSTIN, other name", gstin: GSTIN_A });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "VENDOR_DUPLICATE", field: "gstin", existingVendorId: existing, existingVendorName: "Existing GSTIN Co" });
  });

  it("returns 409 when only the PAN repeats (matched through the GSTINs on file)", async () => {
    const otherState = gstinFor("AABCT1234A", "07"); // same PAN, different state registration
    const res = await create({ name: "Same PAN", pan: "AABCT1234A" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "VENDOR_DUPLICATE", field: "pan" });
    const viaGstin = await create({ name: "Same PAN via GSTIN", gstin: otherState });
    expect(viaGstin.statusCode).toBe(409);
  });

  it("is tenant-scoped: another tenant may register the same GSTIN", async () => {
    await seedVendor(OTHER_TENANT, { name: "Elsewhere", gstin: GSTIN_B });
    const res = await create({ name: "Mine", gstin: GSTIN_B });
    expect(res.statusCode).toBe(202);
  });

  it("the consumer re-checks under a lock: a raced second create persists no second row", async () => {
    const gstin = gstinFor("AABCT5555C");
    const mk = () => randomUUID();
    const [a, b] = [mk(), mk()];
    // Bypass the route pre-check on purpose - both commands are already queued.
    await Promise.all([a, b].map((id) => runWithTenant(TENANT, () => queue.publish(COMMANDS.vendorCreate, {
      messageId: randomUUID(), type: COMMANDS.vendorCreate, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, name: `Raced ${id.slice(0, 4)}`, gstin, mse: false, msme: false },
    }))));
    await queue.drain();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementVendors).where(eq(procurementVendors.gstin, gstin))));
    expect(rows).toHaveLength(1);
  });
});

describe("VENDORS-DETAIL-04: empanelment validity on the vendor profile", () => {
  async function addEmpanelment(vendorId: string, validUntil: string | null, status = "active") {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(procurementEmpanelment).values({
        id: randomUUID(), vendorId, tenantId: TENANT, category: "goods", empanelDate: "2025-01-01",
        validUntil, status, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
  }
  const detail = async (id: string) => (await app.inject({ method: "GET", url: `/v1/procurement/vendors/${id}`, headers: headers() })).json().data;

  it("reports the latest active validity, lapsed=false", async () => {
    const id = await seedVendor(TENANT, { name: "Valid Emp", vendorType: "empanelled" });
    await addEmpanelment(id, "2099-03-31");
    await addEmpanelment(id, "2098-01-01");
    expect(await detail(id)).toMatchObject({ empanelmentValidTill: "2099-03-31", empanelmentLapsed: false });
  });
  it("reports lapsed=true when every empanelment is past its date or inactive", async () => {
    const id = await seedVendor(TENANT, { name: "Lapsed Emp", vendorType: "empanelled" });
    await addEmpanelment(id, "2020-01-01");
    await addEmpanelment(id, "2099-01-01", "cancelled");
    expect(await detail(id)).toMatchObject({ empanelmentLapsed: true });
  });
  it("a vendor with no empanelment row is not 'lapsed'", async () => {
    const id = await seedVendor(TENANT, { name: "No Emp" });
    expect(await detail(id)).toMatchObject({ empanelmentValidTill: null, empanelmentLapsed: false });
  });
});

describe("VENDORS-DETAIL-02: suspend an empanelment (role-gated, reason mandatory)", () => {
  const patch = (id: string, payload: unknown, h = headers()) =>
    app.inject({ method: "PATCH", url: `/v1/procurement/vendors/${id}/suspend`, headers: h, payload: payload as object });
  async function empanelled(name: string) {
    const id = await seedVendor(TENANT, { name, vendorType: "empanelled" });
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(procurementEmpanelment).values({
        id: randomUUID(), vendorId: id, tenantId: TENANT, category: "goods", empanelDate: "2025-01-01",
        validUntil: "2099-01-01", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    return id;
  }

  it("refuses a viewer role (403) and a missing/short reason (400)", async () => {
    const id = await empanelled("Susp Authz");
    const viewer = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["audit_officer"], sid: "s" }, SECRET)}`, "content-type": "application/json" };
    expect((await patch(id, { reason: "Repeated late deliveries" }, viewer)).statusCode).toBe(403);
    expect((await patch(id, { reason: "no" })).statusCode).toBe(400);
    expect((await patch(id, {})).statusCode).toBe(400);
  });

  it("404 for an unknown vendor, 409 when there is no active empanelment", async () => {
    expect((await patch(randomUUID(), { reason: "Repeated late deliveries" })).statusCode).toBe(404);
    const bare = await seedVendor(TENANT, { name: "Susp Bare" });
    const res = await patch(bare, { reason: "Repeated late deliveries" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VENDOR_NOT_EMPANELLED");
  });

  it("suspends the active empanelment through the consumer, so the PO empanelment gate sees it lapse", async () => {
    const id = await empanelled("Susp Happy");
    const res = await patch(id, { reason: "Repeated late deliveries" });
    expect(res.statusCode).toBe(202);
    // The route publishes on the app's own queue; drive the same command through
    // this file's consumer-wired queue, as the worker would.
    await runWithTenant(TENANT, () => queue.publish(COMMANDS.vendorSuspend, {
      messageId: randomUUID(), type: COMMANDS.vendorSuspend, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, reason: "Repeated late deliveries" },
    }));
    await queue.drain();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementEmpanelment).where(eq(procurementEmpanelment.vendorId, id))));
    expect(rows.map((r) => r.status)).toEqual(["suspended"]);
    const d = (await app.inject({ method: "GET", url: `/v1/procurement/vendors/${id}`, headers: headers() })).json().data;
    expect(d.empanelmentLapsed).toBe(true);
    // A second suspend now has nothing active to act on.
    expect((await patch(id, { reason: "Repeated late deliveries" })).statusCode).toBe(409);
  });
});
