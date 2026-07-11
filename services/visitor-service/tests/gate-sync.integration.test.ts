/**
 * Fix 5 (P1): gate-sync returned empty screening data, so offline terminals
 * synced nothing and would admit blacklisted/revoked visitors while offline.
 *
 * Drives the real `loadGateSyncSnapshot` against the live DB and proves a
 * blacklisted identity-doc hash, a watchlisted hash, and a revoked pass all
 * appear in the snapshot for the gate's tenant + location.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { loadGateSyncSnapshot } from "../src/modules/check-in/gate-sync.js";
import { blacklistEntries, watchlistEntries } from "../src/modules/blacklist/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations } from "../src/modules/location/schema.js";

const TENANT = randomUUID();
const LOCATION = randomUUID();
const ACTOR = randomUUID();
const VISIT_REQ_ID = randomUUID();
const REVOKED_PASS_ID = randomUUID();

const BLACKLIST_HASH = "blk_" + randomUUID().replace(/-/g, "");
const WATCHLIST_HASH = "wl_" + randomUUID().replace(/-/g, "");

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
};

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION,
        tenantId: TENANT,
        name: "Gate Location",
        businessHours: BUSINESS_HOURS,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      await tx.insert(visitRequests).values({
        id: VISIT_REQ_ID,
        tenantId: TENANT,
        locationId: LOCATION,
        hostEmployeeId: randomUUID(),
        visitorName: "Pass Holder",
        visitorPhone: "+911234567890",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      await tx.insert(blacklistEntries).values({
        tenantId: TENANT,
        locationId: null, // global for the tenant
        personName: "Blocked Person",
        identityDocHash: BLACKLIST_HASH,
        reason: "security",
        status: "active",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      await tx.insert(watchlistEntries).values({
        tenantId: TENANT,
        locationId: LOCATION,
        personName: "Watched Person",
        identityDocHash: WATCHLIST_HASH,
        active: true,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: REVOKED_PASS_ID,
        tenantId: TENANT,
        visitRequestId: VISIT_REQ_ID,
        locationId: LOCATION,
        passNumber: "P" + Math.floor(Math.random() * 1e9),
        passType: "single",
        status: "revoked",
        qrJwt: "x",
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 86_400_000),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, REVOKED_PASS_ID));
      await tx.delete(blacklistEntries).where(eq(blacklistEntries.tenantId, TENANT));
      await tx.delete(watchlistEntries).where(eq(watchlistEntries.tenantId, TENANT));
      await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQ_ID));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
});

describe("gate-sync snapshot — populated from real screening data", () => {
  it("includes blacklisted/watchlisted hashes and revoked pass ids", async () => {
    const snapshot = await runWithTenant(TENANT, () =>
      loadGateSyncSnapshot(TENANT, LOCATION),
    );

    expect(snapshot.blacklistHashes).toContain(BLACKLIST_HASH);
    expect(snapshot.watchlistHashes).toContain(WATCHLIST_HASH);
    expect(snapshot.revokedPassIds).toContain(REVOKED_PASS_ID);
  });
});
