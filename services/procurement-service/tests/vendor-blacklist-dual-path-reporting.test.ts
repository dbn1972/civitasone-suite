/**
 * Reporting-gap fix: PATCH /v1/procurement/vendors/:id/blacklist
 * (vendor/routes.ts:70 -> vendor/commands.ts:blacklistVendor ->
 * COMMANDS.vendorBlacklist, handled in vendor/consumer.ts) used to flip only
 * vendor.vendorType/blacklistReason and never write a row into
 * procurement.vendor_blacklist -- the table GET /v1/procurement/vendor-blacklist
 * and GET /v1/procurement/vendors/blacklisted actually read via
 * repo.listActiveByTenant(), and the one DELETE /vendors/:id/blacklist
 * (reinstate) route/consumer actually check via repo.findActive()/findActiveTx().
 *
 * A vendor blacklisted ONLY through the PATCH path was therefore invisible to
 * a compliance officer reviewing "all blacklisted vendors" via either listing
 * endpoint, AND could never be reinstated through the standard DELETE route
 * (repo.findActive() found nothing, so the route 404'd before even publishing
 * the reinstate command) -- same root cause, two symptoms.
 *
 * POST /v1/procurement/vendors/:id/blacklist (vendor-blacklist/routes.ts:46 ->
 * vendor-blacklist/commands.ts:addVendorBlacklist -> COMMANDS.vendorBlacklistAdd,
 * handled in vendor-blacklist/consumer.ts) was already correct: it writes the
 * structured vendor_blacklist row AND flips vendor.vendorType.
 *
 * Fix: vendor/consumer.ts's COMMANDS.vendorBlacklist handler now also writes
 * (idempotently, matching uq_vendor_blacklist_active's one-active-row-per-
 * vendor invariant) the same structured row vendor-blacklist/consumer.ts
 * writes, so both entry points converge on ONE source of truth. Both HTTP
 * surfaces are kept (removing either is a breaking API change nobody asked
 * for) -- vendor/routes.ts's PATCH is documented in-code as the legacy/simple
 * form.
 *
 * po/consumer.ts's PO-award blacklist gate already ORs vendorType==='blacklisted'
 * with the vendor_blacklist-table checks (isBlacklistedTx / isCentrallyDebarredTx)
 * -- that gate was never actually broken for either path; only the two listing
 * endpoints and reinstate were. The last test in this file proves the gate for
 * both paths keeps working unchanged (no regression from this fix), on top of
 * proving the reporting gap itself is closed.
 *
 * Runs against the real procurement_svc (NOBYPASSRLS, FORCE RLS) role, same
 * convention as tests/central-debarment.test.ts and
 * tests/tx-001-vendor-blacklist-nested-tx-deadlock.test.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerVendorConsumers } from "../src/modules/vendor/consumer.js";
import { registerVendorBlacklistConsumers } from "../src/modules/vendor-blacklist/consumer.js";
import { vendorBlacklist } from "../src/modules/vendor-blacklist/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import * as blacklistRepo from "../src/modules/vendor-blacklist/repo.js";
import * as vendorRepo from "../src/modules/vendor/repo.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7b1ac000-3003-4000-8000-0000000000f1";
const ACTOR = randomUUID();

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

async function seedVendor(name: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(procurementVendors).values({
    id, tenantId: TENANT, name, vendorType: "registered", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}

async function cleanup() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, TENANT));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
  }));
}

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("PATCH-path blacklist (COMMANDS.vendorBlacklist) writes the same structured row the POST-path does", () => {
  it("a vendor blacklisted ONLY via the PATCH path now appears in listActiveByTenant (the shared query behind both listing endpoints)", async () => {
    await cleanup();
    const vendorId = await seedVendor("Legacy-path Vendor");

    const q = tenantWrappedQueue();
    registerVendorConsumers(q);
    await q.start();
    await q.publish(COMMANDS.vendorBlacklist, {
      messageId: randomUUID(), type: COMMANDS.vendorBlacklist, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: vendorId, tenantId: TENANT, reason: "Repeated GST non-compliance" },
    });
    await q.drain();
    await q.stop();

    // vendor.vendorType side (pre-existing behavior) must still work.
    const vendor = await runWithTenant(TENANT, () => vendorRepo.findVendorById(vendorId, TENANT));
    expect(vendor?.vendorType).toBe("blacklisted");

    // The reporting-gap fix: a structured row must now exist too, and it must
    // be exactly what GET /vendor-blacklist and GET /vendors/blacklisted both
    // read (repo.listActiveByTenant backs both routes identically -- see
    // vendor-blacklist/routes.ts).
    const active = await runWithTenant(TENANT, () => blacklistRepo.findActive(TENANT, vendorId));
    expect(active).not.toBeNull();
    expect(active?.status).toBe("active");
    expect(active?.reason).toBe("Repeated GST non-compliance");

    const listed = await runWithTenant(TENANT, () => blacklistRepo.listActiveByTenant(TENANT, 50, 0));
    expect(listed.some((r) => r.vendorId === vendorId)).toBe(true);
  });

  it("a vendor blacklisted via the PATCH path can now be reinstated through the standard reinstate flow (previously impossible)", async () => {
    await cleanup();
    const vendorId = await seedVendor("Reinstate-path Vendor");

    const q = tenantWrappedQueue();
    registerVendorConsumers(q);
    registerVendorBlacklistConsumers(q);
    await q.start();
    await q.publish(COMMANDS.vendorBlacklist, {
      messageId: randomUUID(), type: COMMANDS.vendorBlacklist, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: vendorId, tenantId: TENANT, reason: "Fraudulent invoice submitted" },
    });
    await q.drain();

    // This is exactly what vendor-blacklist/routes.ts's DELETE handler checks
    // BEFORE even publishing the reinstate command -- pre-fix this was null,
    // so the route 404'd and the reinstate command was never sent at all.
    const preReinstate = await runWithTenant(TENANT, () => blacklistRepo.findActive(TENANT, vendorId));
    expect(preReinstate).not.toBeNull();

    await q.publish(COMMANDS.vendorBlacklistReinstate, {
      messageId: randomUUID(), type: COMMANDS.vendorBlacklistReinstate, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT, vendorId },
    });
    await q.drain();
    await q.stop();

    const vendor = await runWithTenant(TENANT, () => vendorRepo.findVendorById(vendorId, TENANT));
    expect(vendor?.vendorType).toBe("registered");
    const postReinstate = await runWithTenant(TENANT, () => blacklistRepo.findActive(TENANT, vendorId));
    expect(postReinstate).toBeNull();
  });

  it("is idempotent: a vendor already blacklisted via the structured POST path is not double-inserted when the PATCH path also fires for it", async () => {
    await cleanup();
    const vendorId = await seedVendor("Already-structured Vendor");

    const q = tenantWrappedQueue();
    registerVendorBlacklistConsumers(q);
    registerVendorConsumers(q);
    await q.start();

    // POST/structured path first (already correct today).
    await q.publish(COMMANDS.vendorBlacklistAdd, {
      messageId: randomUUID(), type: COMMANDS.vendorBlacklistAdd, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT, vendorId, reason: "CVC order 7", blacklistedFrom: "2026-01-01" },
    });
    await q.drain();

    // PATCH path fires afterward for the same vendor (its route has no 409
    // guard, unlike POST's) -- e.g. a second officer unaware it's already
    // blacklisted.
    await q.publish(COMMANDS.vendorBlacklist, {
      messageId: randomUUID(), type: COMMANDS.vendorBlacklist, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: vendorId, tenantId: TENANT, reason: "Different reason text" },
    });
    await q.drain();
    await q.stop();

    // Exactly one row -- uq_vendor_blacklist_active must not be violated, and
    // no duplicate/second active row silently created.
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(vendorBlacklist).where(eq(vendorBlacklist.vendorId, vendorId))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("CVC order 7"); // first writer wins; PATCH must not overwrite the structured row
  });

  it("both paths independently still block PO creation (po/consumer.ts's blacklist gate is unchanged by this fix)", async () => {
    await cleanup();
    const vendorPatchPath = await seedVendor("Blocks-PO via PATCH path");
    const vendorPostPath = await seedVendor("Blocks-PO via POST path");

    const q = tenantWrappedQueue();
    registerVendorConsumers(q);
    registerVendorBlacklistConsumers(q);
    await q.start();
    await q.publish(COMMANDS.vendorBlacklist, {
      messageId: randomUUID(), type: COMMANDS.vendorBlacklist, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: vendorPatchPath, tenantId: TENANT, reason: "Blocks PO test -- PATCH path" },
    });
    await q.publish(COMMANDS.vendorBlacklistAdd, {
      messageId: randomUUID(), type: COMMANDS.vendorBlacklistAdd, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT, vendorId: vendorPostPath, reason: "Blocks PO test -- POST path", blacklistedFrom: "2026-01-01" },
    });
    await q.drain();
    await q.stop();

    // Mirrors po/consumer.ts's exact gate condition:
    //   isBlacklistedTx || isCentrallyDebarredTx || vendorType === "blacklisted"
    for (const vendorId of [vendorPatchPath, vendorPostPath]) {
      const blocked = await runWithTenant(TENANT, () => db.transaction(async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = await vendorRepo.findVendorByIdTx(tx as any, vendorId, TENANT);
        return (await blacklistRepo.isBlacklistedTx(tx as any, TENANT, vendorId))
          || (await blacklistRepo.isCentrallyDebarredTx(tx as any, v?.pan))
          || v?.vendorType === "blacklisted";
      }));
      expect(blocked, `vendor ${vendorId} should still block PO creation`).toBe(true);
    }
  });
});
