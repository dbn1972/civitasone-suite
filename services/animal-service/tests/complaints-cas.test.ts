/**
 * Direct, DB-level proof that complaints/repo.ts's updateStatus is a real
 * compare-and-swap, bypassing routes/consumers entirely so the guard itself
 * -- not the route-level pre-check that sits in front of it -- is what's
 * under test. Pre-fix, this function's WHERE clause was id+tenantId only:
 * ANY status value would have matched and every one of the "rejected"
 * assertions below would instead have silently applied the write.
 *
 * Every db.transaction() call is wrapped in runWithTenant(...) -- outside
 * an actual HTTP request (see app.ts's onRequest hooks) or a tenantScoped
 * queue consumer (see shared/tenant-queue.ts's withTenantConsumer), nothing
 * else seeds the AsyncLocalStorage context that wrapWithTenantGuc
 * (@civitasone/db) reads to SET LOCAL app.tenant_id for RLS -- without it
 * every insert/update here would be rejected outright by animal_complaints'
 * FORCE ROW LEVEL SECURITY policy (see migrations/0001_initial.sql), not
 * just silently unscoped.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/complaints/repo.js";
import { TENANT_A, ACTOR_A } from "./support.js";

afterAll(async () => {
  await sqlClient.end();
});

async function seedComplaint(status: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      const complaintNumber = `ANML/CASTEST/${Date.now()}/${await repo.nextComplaintNumber(tx)}`;
      await repo.insertComplaint(tx, {
        id,
        tenantId: TENANT_A,
        complaintNumber,
        reportedBy: ACTOR_A,
        location: { ward: "1" },
        animalType: "dog",
        complaintType: "stray",
        description: null,
        photo: null,
        severity: "medium",
        status,
        assignedTo: null,
        assignedTeam: null,
        resolvedAt: null,
        resolution: null,
        createdBy: ACTOR_A,
        updatedBy: ACTOR_A,
      });
    }),
  );
  return id;
}

function findAsTenantA(id: string) {
  return runWithTenant(TENANT_A, () => repo.findById(id, TENANT_A));
}

describe("complaints/repo.ts updateStatus — compare-and-swap guard", () => {
  it("rejects a transition whose allowedFromStatuses does not include the row's actual current status, and leaves the row untouched", async () => {
    const id = await seedComplaint("dispatched");

    // "closed" is only valid from "action_taken" (see domain.ts). This call
    // asks to move to "closed" but only accepts "action_taken" as the
    // source -- the row is actually "dispatched", so this MUST be rejected.
    const ok = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "closed", ACTOR_A, ["action_taken"])),
    );
    expect(ok).toBe(false);

    const row = await findAsTenantA(id);
    expect(row?.status).toBe("dispatched");
    expect(row?.version).toBe(1); // untouched -- not bumped by the rejected attempt
  });

  it("applies the transition when the row's current status IS in allowedFromStatuses", async () => {
    const id = await seedComplaint("assigned");
    const ok = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "dispatched", ACTOR_A, ["assigned"])),
    );
    expect(ok).toBe(true);

    const row = await findAsTenantA(id);
    expect(row?.status).toBe("dispatched");
    expect(row?.version).toBe(2);
  });

  it("proves the guard holds under real concurrency: two updateStatus calls racing for the SAME row commit consistently, with only the one whose allowedFromStatuses actually matches applying", async () => {
    // Reproduces the shape of the race this fix closes (see refund-service's
    // requests/repo.ts header comment, RACE-1, the fleet reference this
    // pattern is mirrored from): two commands submitted concurrently against
    // the same row, racing at the database level (both issued inside
    // Promise.all, so Postgres's own row-lock serializes them -- exactly
    // what would happen for two consumers processing colliding messages).
    // Pre-fix (id+tenantId only, no status predicate), BOTH updates would
    // have matched the row regardless of which ran first, and the row would
    // have ended up in whichever status committed last -- not a rejection,
    // a silent clobber. Post-fix, the invalid one's WHERE clause never
    // matches, in either commit order.
    const id = await seedComplaint("dispatched");

    const [dispatchAgain, actionTaken] = await Promise.all([
      // invalid: "dispatched" is not a valid source for itself
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "dispatched", ACTOR_A, ["assigned"]))),
      // valid: dispatched -> action_taken
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "action_taken", ACTOR_A, ["dispatched"]))),
    ]);

    expect(dispatchAgain).toBe(false);
    expect(actionTaken).toBe(true);

    const row = await findAsTenantA(id);
    expect(row?.status).toBe("action_taken");
    expect(row?.version).toBe(2);
  });

  it("rejects with an empty allowedFromStatuses list (no source status is ever valid)", async () => {
    const id = await seedComplaint("reported");
    const ok = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "assigned", ACTOR_A, [])),
    );
    expect(ok).toBe(false);
    const row = await findAsTenantA(id);
    expect(row?.status).toBe("reported");
  });

  it("is tenant-scoped: a different tenant's session cannot CAS a row it does not own", async () => {
    const id = await seedComplaint("assigned");
    const otherTenant = "e5555555-0000-4000-8000-000000000009";
    const ok = await runWithTenant(otherTenant, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, otherTenant, "dispatched", ACTOR_A, ["assigned"])),
    );
    expect(ok).toBe(false);
    const row = await findAsTenantA(id);
    expect(row?.status).toBe("assigned"); // untouched
  });
});
