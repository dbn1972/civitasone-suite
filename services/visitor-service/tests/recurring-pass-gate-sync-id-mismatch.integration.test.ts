/**
 * check-in/gate-sync.ts's offline-terminal snapshot is the ONE place that
 * tries to account for recurring-pass revocation (it queries
 * `recurring_passes` directly rather than relying on the Redis set — see
 * recurring-pass-gate-revocation-gap.test.ts for the online-path version of
 * this bug). But it selects the wrong column:
 *
 *   modules/check-in/gate-sync.ts ("Revoked or suspended recurring passes"):
 *     tx.select({ id: recurringPasses.id }).from(recurringPasses)...
 *     revokedPassIds: [...dpRows.map(r => r.id), ...rpRows.map(r => r.id)]
 *
 * `revokedPassIds` is matched against a scanned pass's `visit_id` claim,
 * which is the DIGITAL pass's id (`recurring_passes.pass_id`), not the
 * recurring_pass row's OWN primary key. Because the query selects
 * `recurringPasses.id` instead of `recurringPasses.passId`, a suspended or
 * revoked recurring pass's entry in the offline snapshot can never match any
 * real scanned QR — it ships a UUID that will never appear on any badge.
 *
 * Driven against the live DB, matching the existing
 * gate-sync.integration.test.ts pattern.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { loadGateSyncSnapshot } from "../src/modules/check-in/gate-sync.js";
import { recurringPasses } from "../src/modules/recurring-pass/schema.js";
import { locations } from "../src/modules/location/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";

const TENANT = randomUUID();
const LOCATION = randomUUID();
const ACTOR = randomUUID();
const VISIT_REQUEST_ID = randomUUID();
// The recurring_passes row's own primary key — what gate-sync.ts actually
// returns today.
const RECURRING_PASS_ROW_ID = randomUUID();
// recurring_passes.pass_id carries a real FK to digital_passes(id), so the
// underlying digital pass id (what a real scanned QR's visit_id claim would
// actually equal) has to be a genuine digital_passes row, not a bare UUID.
const UNDERLYING_DIGITAL_PASS_ID = randomUUID();

const BUSINESS_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "Contractor Gate", businessHours: BUSINESS_HOURS,
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(visitRequests).values({
        id: VISIT_REQUEST_ID, tenantId: TENANT, locationId: LOCATION, hostEmployeeId: ACTOR,
        visitorName: "Suspended Contractor", visitorPhone: "+911234567890",
        passType: "recurring", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: UNDERLYING_DIGITAL_PASS_ID, tenantId: TENANT, visitRequestId: VISIT_REQUEST_ID, locationId: LOCATION,
        passNumber: "RP" + Math.floor(Math.random() * 1e9), passType: "recurring", status: "active",
        qrJwt: "x", validFrom: new Date(), validUntil: new Date(Date.now() + 30 * 86_400_000),
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(recurringPasses).values({
        id: RECURRING_PASS_ROW_ID,
        tenantId: TENANT,
        locationId: LOCATION,
        passId: UNDERLYING_DIGITAL_PASS_ID,
        visitorName: "Suspended Contractor",
        visitorPhone: "+911234567890",
        validFrom: new Date(Date.now() - 86_400_000),
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        permittedDays: [0, 1, 2, 3, 4, 5, 6],
        status: "suspended",
        issuedBy: ACTOR,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(recurringPasses).where(eq(recurringPasses.id, RECURRING_PASS_ROW_ID));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, UNDERLYING_DIGITAL_PASS_ID));
      await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
});

describe("gate-sync snapshot for a suspended recurring pass (today's actual behavior)", () => {
  it("includes the recurring_passes row's own id, not its underlying digital pass id", async () => {
    const snapshot = await runWithTenant(TENANT, () => loadGateSyncSnapshot(TENANT, LOCATION));

    expect(snapshot.revokedPassIds).toContain(RECURRING_PASS_ROW_ID);
    expect(snapshot.revokedPassIds).not.toContain(UNDERLYING_DIGITAL_PASS_ID);
  });
});

describe("what SHOULD happen (fails today)", () => {
  it.fails("the suspended recurring pass's underlying digital-pass id is present, so an offline gate terminal actually rejects it", async () => {
    const snapshot = await runWithTenant(TENANT, () => loadGateSyncSnapshot(TENANT, LOCATION));

    expect(snapshot.revokedPassIds).toContain(UNDERLYING_DIGITAL_PASS_ID);
  });
});
