/**
 * Direct, DB-level proof that repo.ts's `update()` is a real compare-and-
 * swap keyed on `version` -- for both complaints and hotspots (both use the
 * identical shape: `.where(and(eq(id), eq(tenantId), eq(version, currentVersion)))`
 * plus `version: sql\`${col.version} + 1\`` in the SET clause). Bypasses
 * routes/consumers entirely so the guard itself is what's under test, not
 * the route-level version pre-check that sits in front of it (which is a
 * convenience 409 fast-fail, not the actual safety mechanism -- the DB-level
 * WHERE clause is).
 *
 * Every db.transaction() call is wrapped in runWithTenant(...): outside a
 * real HTTP request (app.ts's onRequest hooks) or a tenantScoped queue
 * consumer (shared/tenant-queue.ts's withTenantConsumer), nothing else seeds
 * the AsyncLocalStorage context that the tenant-GUC-wrapped `db` reads to SET
 * LOCAL app.tenant_id for RLS -- without it, every insert/update here would
 * be rejected by drainage_complaints'/drainage_hotspots' FORCE ROW LEVEL
 * SECURITY policy, not just silently unscoped.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID, randomInt } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as complaintsRepo from "../src/modules/complaints/repo.js";
import * as hotspotsRepo from "../src/modules/hotspots/repo.js";
import { TENANT_A, ACTOR_A } from "./support.js";

afterAll(async () => {
  await sqlClient.end();
});

async function seedComplaint(): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT_A, () =>
    db.transaction((tx) =>
      complaintsRepo.insert(tx, {
        id,
        tenantId: TENANT_A,
        complaintNumber: `DRN-CASTEST-${Date.now()}-${randomInt(1000, 9999)}`,
        reportedBy: ACTOR_A,
        location: { ward: "1" },
        complaintType: "blocked_drain",
        description: null,
        photo: null,
        severity: "medium",
        status: "reported",
        createdBy: ACTOR_A,
        updatedBy: ACTOR_A,
      }),
    ),
  );
  return id;
}

async function seedHotspot(): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT_A, () =>
    db.transaction((tx) =>
      hotspotsRepo.insert(tx, {
        id,
        tenantId: TENANT_A,
        hotspotCode: `DRNH-CASTEST-${Date.now()}-${randomInt(1000, 9999)}`,
        location: { ward: "1" },
        category: "test",
        complaintCount: 1,
        riskScore: 10,
        status: "identified",
        createdBy: ACTOR_A,
        updatedBy: ACTOR_A,
      }),
    ),
  );
  return id;
}

function findComplaint(id: string) {
  return runWithTenant(TENANT_A, () => complaintsRepo.findById(id, TENANT_A));
}
function findHotspot(id: string) {
  return runWithTenant(TENANT_A, () => hotspotsRepo.findById(id, TENANT_A));
}

describe("complaints/repo.ts update() -- compare-and-swap on version", () => {
  it("rejects an update whose currentVersion does not match the row's actual version, and leaves the row untouched", async () => {
    const id = await seedComplaint();
    const ok = await runWithTenant(TENANT_A, () => db.transaction((tx) => complaintsRepo.update(tx, id, TENANT_A, { status: "assigned" }, 99)));
    expect(ok).toBe(false);
    const row = await findComplaint(id);
    expect(row?.status).toBe("reported");
    expect(row?.version).toBe(1);
  });

  it("applies the update and bumps version when currentVersion matches", async () => {
    const id = await seedComplaint();
    const ok = await runWithTenant(TENANT_A, () => db.transaction((tx) => complaintsRepo.update(tx, id, TENANT_A, { status: "assigned" }, 1)));
    expect(ok).toBe(true);
    const row = await findComplaint(id);
    expect(row?.status).toBe("assigned");
    expect(row?.version).toBe(2);
  });

  it("proves the guard holds under real concurrency: two updates racing for the SAME row and SAME currentVersion commit consistently -- exactly one applies, version increments exactly once, no silent clobber", async () => {
    const id = await seedComplaint();
    const [first, second] = await Promise.all([
      runWithTenant(TENANT_A, () => db.transaction((tx) => complaintsRepo.update(tx, id, TENANT_A, { status: "assigned" }, 1))),
      runWithTenant(TENANT_A, () => db.transaction((tx) => complaintsRepo.update(tx, id, TENANT_A, { status: "closed" }, 1))),
    ]);
    // Postgres's row lock serializes these; the first to commit wins the
    // version=1 predicate and the second necessarily sees version=2 -> false.
    const results = [first, second];
    expect(results.filter((r) => r === true)).toHaveLength(1);
    expect(results.filter((r) => r === false)).toHaveLength(1);

    const row = await findComplaint(id);
    expect(row?.version).toBe(2); // bumped exactly once, not twice
    expect(["assigned", "closed"]).toContain(row?.status);
  });

  it("is tenant-scoped: a different tenant's session cannot CAS a row it does not own, even with the correct version", async () => {
    const id = await seedComplaint();
    const otherTenant = "e5555555-0000-4000-8000-000000000009";
    const ok = await runWithTenant(otherTenant, () => db.transaction((tx) => complaintsRepo.update(tx, id, otherTenant, { status: "assigned" }, 1)));
    expect(ok).toBe(false);
    const row = await findComplaint(id);
    expect(row?.status).toBe("reported"); // untouched
  });
});

describe("hotspots/repo.ts update() -- compare-and-swap on version", () => {
  it("rejects a stale-version update and leaves the row untouched", async () => {
    const id = await seedHotspot();
    const ok = await runWithTenant(TENANT_A, () => db.transaction((tx) => hotspotsRepo.update(tx, id, TENANT_A, { status: "action_planned" }, 5)));
    expect(ok).toBe(false);
    const row = await findHotspot(id);
    expect(row?.status).toBe("identified");
    expect(row?.version).toBe(1);
  });

  it("proves the guard holds under real concurrency for hotspots too: only one of two racing same-version updates applies", async () => {
    const id = await seedHotspot();
    const [a, b] = await Promise.all([
      runWithTenant(TENANT_A, () => db.transaction((tx) => hotspotsRepo.update(tx, id, TENANT_A, { status: "action_planned", maintenancePlanRef: "A" }, 1))),
      runWithTenant(TENANT_A, () => db.transaction((tx) => hotspotsRepo.update(tx, id, TENANT_A, { status: "action_planned", maintenancePlanRef: "B" }, 1))),
    ]);
    expect([a, b].filter((r) => r === true)).toHaveLength(1);
    expect([a, b].filter((r) => r === false)).toHaveLength(1);
    const row = await findHotspot(id);
    expect(row?.version).toBe(2);
    expect(["A", "B"]).toContain(row?.maintenancePlanRef);
  });
});
