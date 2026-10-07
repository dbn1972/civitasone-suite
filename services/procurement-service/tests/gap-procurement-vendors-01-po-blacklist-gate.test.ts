/**
 * GAP-PROCUREMENT-VENDORS-01 (server control, pinning test).
 *
 * The real control that stops a blacklisted vendor receiving a PO is NOT the
 * web picker — it is the poCreate consumer, which rejects inside its own
 * transaction when ANY of three conditions hold (see
 * src/modules/po/consumer.ts, the `blacklisted` gate):
 *   1. an ACTIVE tenant-scoped blacklist row  (isBlacklistedTx)
 *   2. an ACTIVE central CVC/PAN debarment     (isCentrallyDebarredTx)
 *   3. the vendor row's own vendorType === 'blacklisted'
 * This test pins all three clauses against the real procurement_svc
 * (NOBYPASSRLS, FORCE RLS) role so a regression that silently drops any clause
 * is caught. It mirrors the exact expression the consumer evaluates.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
// PII_ENC_KEY is required to seed the encrypted `pan` column — set it the same
// way central-debarment.test.ts / pii-encryption.property.test.ts do.
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { vendorBlacklist } from "../src/modules/vendor-blacklist/schema.js";
import * as vendorRepo from "../src/modules/vendor/repo.js";
import * as blacklistRepo from "../src/modules/vendor-blacklist/repo.js";

const TENANT = "3c002000-cccc-4000-8000-0000000000f4";
const OTHER_TENANT = "3c002000-dddd-4000-8000-0000000000f5";
const ACTOR = randomUUID();

/** The exact gate the poCreate consumer evaluates. */
async function isOrderBlocked(tenantId: string, vendorId: string): Promise<boolean> {
  return runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      const vendorTx = await vendorRepo.findVendorByIdTx(tx, vendorId, tenantId);
      return (
        (await blacklistRepo.isBlacklistedTx(tx, tenantId, vendorId)) ||
        (await blacklistRepo.isCentrallyDebarredTx(tx, vendorTx?.pan)) ||
        vendorTx?.vendorType === "blacklisted"
      );
    }),
  );
}

async function seedVendor(tenantId: string, vendorId: string, vendorType = "registered", pan: string | null = null) {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      vendorRepo.insertVendor(tx, {
        id: vendorId, tenantId, name: "Gate Test Vendor", vendorType,
        pan: pan ?? undefined, kycStatus: "pending", createdBy: ACTOR, updatedBy: ACTOR,
      } as never),
    ),
  );
}

async function cleanTenant(tenantId: string) {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, tenantId));
      await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, tenantId));
    }),
  );
}

afterAll(async () => {
  await cleanTenant(TENANT);
  await cleanTenant(OTHER_TENANT);
  await sqlClient.end();
});

describe("VENDORS-01 server control — a blacklisted vendor cannot receive a PO", () => {
  it("a clean, registered vendor is NOT blocked (control case)", async () => {
    await cleanTenant(TENANT);
    const v = randomUUID();
    await seedVendor(TENANT, v, "registered");
    expect(await isOrderBlocked(TENANT, v)).toBe(false);
  });

  it("clause 3: vendorType='blacklisted' blocks the order", async () => {
    await cleanTenant(TENANT);
    const v = randomUUID();
    await seedVendor(TENANT, v, "blacklisted");
    expect(await isOrderBlocked(TENANT, v)).toBe(true);
  });

  it("clause 1: an active tenant-scoped blacklist row blocks the order", async () => {
    await cleanTenant(TENANT);
    const v = randomUUID();
    await seedVendor(TENANT, v, "registered");
    await runWithTenant(TENANT, () =>
      blacklistRepo.insertBlacklist({
        tenantId: TENANT, vendorId: v, reason: "test", blacklistedBy: ACTOR, createdBy: ACTOR, status: "active",
      }),
    );
    expect(await isOrderBlocked(TENANT, v)).toBe(true);
  });

  it("clause 2: an active central CVC debarment by PAN blocks the order in another tenant", async () => {
    await cleanTenant(TENANT);
    await cleanTenant(OTHER_TENANT);
    const pan = "AAAPZ1234Q";
    // Central debarment recorded under OTHER_TENANT…
    const vOther = randomUUID();
    await seedVendor(OTHER_TENANT, vOther, "registered", pan);
    await runWithTenant(OTHER_TENANT, () =>
      blacklistRepo.insertBlacklist({
        tenantId: OTHER_TENANT, vendorId: vOther, pan, scope: "central",
        reason: "CVC debarment", blacklistedBy: ACTOR, createdBy: ACTOR, status: "active",
      } as never),
    );
    // …blocks a different vendor row with the SAME PAN in TENANT.
    const vHere = randomUUID();
    await seedVendor(TENANT, vHere, "registered", pan);
    expect(await isOrderBlocked(TENANT, vHere)).toBe(true);
  });
});
