/**
 * w0-report.md: POST /v1/procurement/pos returned 202 for a blacklisted vendor
 * and the rejection only happened later, asynchronously, in the consumer. The
 * route now pre-checks and returns 422 VENDOR_BLACKLISTED with NO command
 * enqueued. Covers all three blacklist clauses; a clean vendor still gets 202.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { vendorBlacklist } from "../src/modules/vendor-blacklist/schema.js";

const TENANT = "11111111-eeee-4000-8000-0000000000b2";
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const headers = { authorization: `Bearer ${signToken({ sub: "u-w0po", tid: TENANT, roles: ["procurement_officer"], sid: "s-w0po" }, SECRET)}` };

const CLEAN = randomUUID();
const TYPE_BLACKLISTED = randomUUID();
const TENANT_LISTED = randomUUID();
const CENTRAL_PAN = "ZZZZZ9999Z";
const CENTRALLY_DEBARRED = randomUUID();

function poBody(vendorId: string) {
  return {
    vendorId, indentRef: `procurement_indent:${randomUUID()}`,
    gemOrderRef: "GEM/TEST/BASIS", // D4c #28: no empanelment record -> needs a GeM/tender basis
    items: [{ itemCode: "IC-1", description: "Widget", quantity: 1, unit: "nos", unitPriceMinor: 100 }],
  };
}

async function seed() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    const base = { tenantId: TENANT, createdBy: ACTOR, updatedBy: ACTOR };
    await tx.insert(procurementVendors).values([
      { ...base, id: CLEAN, name: "Clean Co", vendorType: "registered" },
      { ...base, id: TYPE_BLACKLISTED, name: "Typed Black", vendorType: "blacklisted" },
      { ...base, id: TENANT_LISTED, name: "Listed Co", vendorType: "registered" },
      { ...base, id: CENTRALLY_DEBARRED, name: "Debarred Co", vendorType: "registered", pan: CENTRAL_PAN },
    ]);
    await tx.insert(vendorBlacklist).values([
      { tenantId: TENANT, vendorId: TENANT_LISTED, reason: "fraud", blacklistedBy: ACTOR, status: "active" },
      { tenantId: TENANT, vendorId: randomUUID(), scope: "central", pan: CENTRAL_PAN, reason: "CVC order", blacklistedBy: ACTOR, status: "active" },
    ]);
  }));
}
async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, TENANT));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
  }));
}

beforeAll(async () => { await clean(); await seed(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("POST /v1/procurement/pos — synchronous blacklist pre-check", () => {
  for (const [label, vendorId] of [
    ["vendor whose own type is 'blacklisted'", TYPE_BLACKLISTED],
    ["vendor with an active tenant blacklist row", TENANT_LISTED],
    ["vendor whose PAN is centrally debarred", CENTRALLY_DEBARRED],
  ] as const) {
    it(`422 VENDOR_BLACKLISTED and nothing enqueued: ${label}`, async () => {
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers, payload: poBody(vendorId) });
      await app.close();
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("VENDOR_BLACKLISTED");
      expect(publish).not.toHaveBeenCalled();
    });
  }

  it("a clean vendor is still accepted (202) and the command is enqueued once", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers, payload: poBody(CLEAN) });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
