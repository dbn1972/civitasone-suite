/**
 * Integration test (Fix 7): guard-console live-occupancy read.
 *
 * Drives the REAL listActiveVisitors query against the live DB and proves:
 *   - two checked-in + one checked-out visitor → the read returns exactly the
 *     two currently inside (the checked-out one is excluded);
 *   - the overstay flag is computed from valid_until;
 *   - the optional locationId scopes the result;
 *   - it is tenant/RLS scoped — another tenant's GUC sees NONE of them.
 *
 * This is the normal role-gated read (distinct from the break-glass evacuation
 * roster) and exposes only guard-necessary fields.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { listActiveVisitors } from "../src/modules/check-in/repo.js";
import { checkIns } from "../src/modules/check-in/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations, gates } from "../src/modules/location/schema.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const L1 = randomUUID();
const L2 = randomUUID();
const G1 = randomUUID();
const BUSINESS_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

// pass1: checked_in @ L1, not overstay | pass2: checked_in @ L2, overstay | pass3: checked_out @ L1 (excluded)
const P1 = randomUUID(), P2 = randomUUID(), P3 = randomUUID();
const VR1 = randomUUID(), VR2 = randomUUID(), VR3 = randomUUID();

async function seedVisit(tx: any, tenant: string, vrId: string, locId: string, name: string) {
  await tx.insert(visitRequests).values({
    id: vrId, tenantId: tenant, locationId: locId, hostEmployeeId: randomUUID(),
    visitorName: name, visitorPhone: "+911234567890", createdBy: ACTOR, updatedBy: ACTOR,
  });
}
async function seedPass(tx: any, tenant: string, id: string, vrId: string, locId: string, status: string, validUntil: Date) {
  await tx.insert(digitalPasses).values({
    id, tenantId: tenant, visitRequestId: vrId, locationId: locId,
    passNumber: "P" + Math.floor(Math.random() * 1e9), passType: "single", status,
    qrJwt: "x", validFrom: new Date(Date.now() - 3_600_000), validUntil, createdBy: ACTOR, updatedBy: ACTOR,
  });
}
async function seedCheckIn(tx: any, tenant: string, passId: string, locId: string, direction: string, ts: Date) {
  await tx.insert(checkIns).values({
    tenantId: tenant, passId, locationId: locId, gateId: G1, direction, timestamp: ts, createdBy: ACTOR,
  });
}

beforeAll(async () => {
  const now = Date.now();
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({ id: L1, tenantId: TENANT_A, name: "L1", businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(locations).values({ id: L2, tenantId: TENANT_A, name: "L2", businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(gates).values({ id: G1, tenantId: TENANT_A, locationId: L1, name: "G1", createdBy: ACTOR, updatedBy: ACTOR });
      await seedVisit(tx, TENANT_A, VR1, L1, "Alice Inside");
      await seedVisit(tx, TENANT_A, VR2, L2, "Bob Overstay");
      await seedVisit(tx, TENANT_A, VR3, L1, "Carol Left");
      await seedPass(tx, TENANT_A, P1, VR1, L1, "checked_in", new Date(now + 3_600_000)); // valid
      await seedPass(tx, TENANT_A, P2, VR2, L2, "checked_in", new Date(now - 3_600_000)); // overstay
      await seedPass(tx, TENANT_A, P3, VR3, L1, "checked_out", new Date(now + 3_600_000)); // left
      await seedCheckIn(tx, TENANT_A, P1, L1, "in", new Date(now - 1_800_000));
      await seedCheckIn(tx, TENANT_A, P2, L2, "in", new Date(now - 5_400_000));
      await seedCheckIn(tx, TENANT_A, P3, L1, "in", new Date(now - 7_200_000));
      await seedCheckIn(tx, TENANT_A, P3, L1, "out", new Date(now - 600_000));
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      await tx.delete(checkIns).where(eq(checkIns.tenantId, TENANT_A));
      await tx.delete(digitalPasses).where(eq(digitalPasses.tenantId, TENANT_A));
      await tx.delete(visitRequests).where(eq(visitRequests.tenantId, TENANT_A));
      await tx.delete(gates).where(eq(gates.id, G1));
      await tx.delete(locations).where(eq(locations.id, L1));
      await tx.delete(locations).where(eq(locations.id, L2));
    }),
  );
});

describe("listActiveVisitors — guard-console live occupancy (Fix 7)", () => {
  it("returns the two checked-in visitors, excluding the checked-out one", async () => {
    const rows = await runWithTenant(TENANT_A, () => listActiveVisitors(TENANT_A));
    const names = rows.map((r) => r.visitorName).sort();
    expect(rows).toHaveLength(2);
    expect(names).toEqual(["Alice Inside", "Bob Overstay"]);
    expect(names).not.toContain("Carol Left");
  });

  it("computes the overstay flag and includes a check-in time", async () => {
    const rows = await runWithTenant(TENANT_A, () => listActiveVisitors(TENANT_A));
    const alice = rows.find((r) => r.visitorName === "Alice Inside")!;
    const bob = rows.find((r) => r.visitorName === "Bob Overstay")!;
    expect(alice.overstay).toBe(false);
    expect(bob.overstay).toBe(true);
    expect(alice.checkInTime).not.toBeNull();
    expect(bob.checkInTime).not.toBeNull();
    // Only guard-necessary fields; no raw PII beyond the name.
    expect(alice).not.toHaveProperty("visitorPhone");
  });

  it("scopes to a location when locationId is supplied", async () => {
    const rows = await runWithTenant(TENANT_A, () => listActiveVisitors(TENANT_A, L1));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.visitorName).toBe("Alice Inside");
  });

  it("is tenant/RLS scoped — another tenant's context sees none of them", async () => {
    const rows = await runWithTenant(TENANT_B, () => listActiveVisitors(TENANT_A));
    expect(rows).toHaveLength(0);
  });
});
