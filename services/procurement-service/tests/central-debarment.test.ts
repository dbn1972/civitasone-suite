/**
 * R17 — federated (CVC / government-wide) vendor debarment.
 *
 * A central debarment recorded against a firm's PAN must block that PAN in
 * EVERY tenant — not just the authority that recorded it. A tenant-scoped
 * blacklist row must NOT leak into the central check.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { vendorBlacklist } from "../src/modules/vendor-blacklist/schema.js";
import * as repo from "../src/modules/vendor-blacklist/repo.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import * as vendorRepo from "../src/modules/vendor/repo.js";
import { resetPiiKeyCache } from "../src/shared/pii-crypto.js";

const TENANT_A = "3c000000-aaaa-4000-8000-0000000000f1";
const TENANT_B = "3c000000-bbbb-4000-8000-0000000000f1";
const PAN = "ABCDE1234F";
const OTHER_PAN = "ZZZZZ9999Z";

// vendor.pan is encrypted at rest (encryptedText); the "reproduces the
// reported live bug" test below inserts a real vendor row, so it needs a
// PII_ENC_KEY the same way pii-encryption.property.test.ts does.
beforeAll(() => {
  process.env.PII_ENC_KEY = "test_pii_encryption_key_32chars!!";
  process.env.PII_KEY_ID = "k1";
  resetPiiKeyCache();
});

async function clean() {
  await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
    await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, TENANT_A));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT_A));
  }));
  await runWithTenant(TENANT_B, () => db.transaction(async (tx) => {
    await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, TENANT_B));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT_B));
  }));
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("federated central debarment (R17)", () => {
  it("a central debarment recorded by tenant A blocks the PAN for tenant B", async () => {
    await runWithTenant(TENANT_A, () => repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: "00000000-0000-0000-0000-000000000000",
      scope: "central", pan: PAN, reason: "CVC debarment order 42",
      blacklistedBy: randomUUID(), createdBy: randomUUID(),
      blacklistedFrom: "2026-01-01", status: "active",
    }));
    // The check is tenant-agnostic — any tenant's vendor with this PAN is blocked.
    const debarred = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      repo.isCentrallyDebarredTx(tx as any, PAN)
    ));
    expect(debarred).toBe(true);
    const found = await runWithTenant(TENANT_A, () => repo.findActiveCentralByPan(PAN));
    expect(found).not.toBeNull();
  });

  it("is case-insensitive on PAN", async () => {
    await runWithTenant(TENANT_A, () => repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: "00000000-0000-0000-0000-000000000000",
      scope: "central", pan: PAN, reason: "CVC order", blacklistedBy: randomUUID(),
      createdBy: randomUUID(), blacklistedFrom: "2026-01-01", status: "active",
    }));
    const debarred = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      repo.isCentrallyDebarredTx(tx as any, PAN.toLowerCase())
    ));
    expect(debarred).toBe(true);
  });

  it("does not block a different PAN", async () => {
    await runWithTenant(TENANT_A, () => repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: "00000000-0000-0000-0000-000000000000",
      scope: "central", pan: PAN, reason: "CVC order", blacklistedBy: randomUUID(),
      createdBy: randomUUID(), blacklistedFrom: "2026-01-01", status: "active",
    }));
    const otherDebarred = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      repo.isCentrallyDebarredTx(tx as any, OTHER_PAN)
    ));
    expect(otherDebarred).toBe(false);
    const nullDebarred = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      repo.isCentrallyDebarredTx(tx as any, null)
    ));
    expect(nullDebarred).toBe(false);
  });

  it("a tenant-scoped blacklist row does NOT count as a central debarment", async () => {
    await runWithTenant(TENANT_A, () => repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: randomUUID(),
      scope: "tenant", pan: PAN, reason: "local blacklist", blacklistedBy: randomUUID(),
      createdBy: randomUUID(), blacklistedFrom: "2026-01-01", status: "active",
    }));
    const debarred = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      repo.isCentrallyDebarredTx(tx as any, PAN)
    ));
    expect(debarred).toBe(false);
  });

  it("a reinstated central debarment no longer blocks", async () => {
    await runWithTenant(TENANT_A, () => repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: "00000000-0000-0000-0000-000000000000",
      scope: "central", pan: PAN, reason: "CVC order", blacklistedBy: randomUUID(),
      createdBy: randomUUID(), blacklistedFrom: "2026-01-01", status: "reinstated",
    }));
    const debarred = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      repo.isCentrallyDebarredTx(tx as any, PAN)
    ));
    expect(debarred).toBe(false);
  });

  // --- RLS regression coverage -----------------------------------------
  //
  // The test above ("blocks the PAN for tenant B") is misleadingly named:
  // it re-checks under runWithTenant(TENANT_A, ...) — the SAME tenant that
  // inserted the row — so tenant_isolation_policy's plain
  // `tenant_id = current_tenant_id()` already lets it through regardless of
  // `scope`. It never actually switches to tenant B's own RLS context, so it
  // cannot catch a central debarment being invisible cross-tenant. The two
  // tests below check under TENANT B's OWN session instead — the only way to
  // exercise the real RLS policy the way the live PO-award gate does.

  it("RLS: a central debarment is visible under a DIFFERENT tenant's own session", async () => {
    await runWithTenant(TENANT_A, () => repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: "00000000-0000-0000-0000-000000000000",
      scope: "central", pan: PAN, reason: "CVC debarment order 42",
      blacklistedBy: randomUUID(), createdBy: randomUUID(),
      blacklistedFrom: "2026-01-01", status: "active",
    }));

    // Switch RLS context to TENANT B — a tenant that never recorded this
    // debarment — before checking. This is what the bug defeated: without
    // the additive central_scope_read_policy, FORCE ROW LEVEL SECURITY hides
    // tenant A's row from tenant B's session entirely, so every read below
    // would silently see nothing.
    const debarredForB = await runWithTenant(TENANT_B, () => db.transaction(async (tx) =>
      repo.isCentrallyDebarredTx(tx as any, PAN)
    ));
    expect(debarredForB).toBe(true);

    const foundByB = await runWithTenant(TENANT_B, () => repo.findActiveCentralByPan(PAN));
    expect(foundByB).not.toBeNull();

    const listedForB = await runWithTenant(TENANT_B, () => repo.listActiveCentral());
    expect(listedForB.some((r) => r.pan === PAN)).toBe(true);

    // And at the raw RLS layer directly — no repo-level WHERE clause at all —
    // tenant B's session can see tenant A's row precisely because it is
    // scope='central'.
    const rawVisibleToB = await runWithTenant(TENANT_B, () => db.transaction((tx) =>
      tx.select().from(vendorBlacklist)
    ));
    expect(rawVisibleToB.some((r) => r.tenantId === TENANT_A && r.scope === "central" && r.pan === PAN)).toBe(true);
  });

  it("RLS: tenant-scoped (non-central) blacklist rows stay isolated from other tenants", async () => {
    const vendorIdA = randomUUID();
    await runWithTenant(TENANT_A, () => repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: vendorIdA,
      scope: "tenant", pan: PAN, reason: "tenant A's own local blacklist (not central)",
      blacklistedBy: randomUUID(), createdBy: randomUUID(),
      blacklistedFrom: "2026-01-01", status: "active",
    }));

    // Guard against a fix that's too broad: the additive policy must ONLY
    // expose scope='central' rows. Tenant A's tenant-scoped row must remain
    // invisible to tenant B, even via a raw, completely unfiltered SELECT
    // under tenant B's own session/RLS context.
    const rawVisibleToB = await runWithTenant(TENANT_B, () => db.transaction((tx) =>
      tx.select().from(vendorBlacklist)
    ));
    expect(rawVisibleToB.some((r) => r.tenantId === TENANT_A)).toBe(false);

    // The tenant-scoped repo helper agrees.
    const debarred = await runWithTenant(TENANT_B, () => db.transaction(async (tx) =>
      repo.isCentrallyDebarredTx(tx as any, PAN)
    ));
    expect(debarred).toBe(false);
  });

  it("reproduces the reported live bug: tenant B's own new vendor carrying the debarred PAN is blocked at the PO-award gate", async () => {
    await runWithTenant(TENANT_A, () => repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: "00000000-0000-0000-0000-000000000000",
      scope: "central", pan: PAN, reason: "CVC debarment order 42",
      blacklistedBy: randomUUID(), createdBy: randomUUID(),
      blacklistedFrom: "2026-01-01", status: "active",
    }));

    // A completely unrelated vendor, freshly created by tenant B, that just
    // happens to share the debarred firm's PAN — exactly the live scenario.
    const tenantBVendorId = randomUUID();
    await runWithTenant(TENANT_B, () => db.transaction((tx) => vendorRepo.insertVendor(tx, {
      id: tenantBVendorId, tenantId: TENANT_B, name: "Unrelated Firm (tenant B)",
      pan: PAN, vendorType: "registered",
      createdBy: randomUUID(), updatedBy: randomUUID(),
    })));

    // Exactly the OR-condition po/consumer.ts's PO-award gate evaluates:
    // isBlacklistedTx || isCentrallyDebarredTx || vendorType === "blacklisted".
    // Before the fix this evaluated false for tenant B — the reported bug:
    // the PO was created with zero rejection.
    const blockedAtPoGate = await runWithTenant(TENANT_B, () => db.transaction(async (tx) => {
      const vendorTx = await vendorRepo.findVendorByIdTx(tx, tenantBVendorId, TENANT_B);
      return (
        (await repo.isBlacklistedTx(tx as any, TENANT_B, tenantBVendorId)) ||
        (await repo.isCentrallyDebarredTx(tx as any, vendorTx?.pan)) ||
        vendorTx?.vendorType === "blacklisted"
      );
    }));
    expect(blockedAtPoGate).toBe(true);
  });
});
