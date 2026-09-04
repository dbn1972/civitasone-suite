/**
 * Direct, DB-level proof that registration/repo.ts's updateStatus is a real
 * compare-and-swap, mirroring tests/complaints-cas.test.ts (see that file
 * for the full rationale -- identical bug shape, identical fix, and the
 * same reason every db.transaction() call here is wrapped in
 * runWithTenant(...): outside a real HTTP request or a tenantScoped queue
 * consumer, nothing else sets the app.tenant_id GUC that animal_registrations'
 * FORCE ROW LEVEL SECURITY policy requires).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/registration/repo.js";
import { TENANT_A, ACTOR_A } from "./support.js";

afterAll(async () => {
  await sqlClient.end();
});

async function seedRegistration(status: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      const registrationNumber = `ANML-REG/CASTEST/${Date.now()}/${await repo.nextRegistrationNumber(tx)}`;
      await repo.insertRegistration(tx, {
        id,
        tenantId: TENANT_A,
        registrationNumber,
        ownerName: "Test Owner",
        ownerPhone: "9000000000",
        ownerAddress: { line1: "1 Test St", city: "Pune", pin: "411001" },
        animalType: "dog",
        breed: null,
        name: null,
        color: null,
        age: null,
        sex: null,
        microchipId: null,
        vaccinationRecords: null,
        photo: null,
        status,
        validUntil: null,
        feeMinor: 50000n,
        currency: "INR",
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

describe("registration/repo.ts updateStatus — compare-and-swap guard", () => {
  it("rejects a transfer attempt when the row is not actually 'active', and leaves it untouched", async () => {
    const id = await seedRegistration("transferred");
    const ok = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "transferred", ACTOR_A, ["active"])),
    );
    expect(ok).toBe(false);
    const row = await findAsTenantA(id);
    expect(row?.status).toBe("transferred");
    expect(row?.version).toBe(1);
  });

  it("rejects renewal of a 'deceased' registration (not in the allowed active/expired set)", async () => {
    const id = await seedRegistration("deceased");
    const ok = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "active", ACTOR_A, ["active", "expired"])),
    );
    expect(ok).toBe(false);
    const row = await findAsTenantA(id);
    expect(row?.status).toBe("deceased");
  });

  it("applies a valid transition and bumps version", async () => {
    const id = await seedRegistration("expired");
    const ok = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "active", ACTOR_A, ["active", "expired"])),
    );
    expect(ok).toBe(true);
    const row = await findAsTenantA(id);
    expect(row?.status).toBe("active");
    expect(row?.version).toBe(2);
  });

  it("is tenant-scoped: a different tenant's session cannot CAS a row it does not own", async () => {
    const id = await seedRegistration("active");
    const otherTenant = "e5555555-0000-4000-8000-000000000009";
    const ok = await runWithTenant(otherTenant, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, otherTenant, "transferred", ACTOR_A, ["active"])),
    );
    expect(ok).toBe(false);
    const row = await findAsTenantA(id);
    expect(row?.status).toBe("active");
  });
});
