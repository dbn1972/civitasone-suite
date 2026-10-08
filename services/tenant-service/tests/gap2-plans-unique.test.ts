/**
 * GAP2-TENANT-PLANS-UNIQUE-05 — plans.plans is tenant-scoped (tenant_id NOT
 * NULL, RLS forced) but its UNIQUE used to be on `code` alone (plans_code_key),
 * so two tenants could not each hold a plan with the same code — the second
 * tenant's INSERT failed with a cross-tenant unique violation. Migration 0028
 * replaces it with UNIQUE(tenant_id, code).
 *
 * This test inserts code='PSU' for TWO different tenants (both must succeed),
 * then a SECOND 'PSU' for the SAME tenant (must still fail). It FAILS on the
 * old schema: the first cross-tenant insert of a duplicate code was rejected.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { plans } from "../src/modules/plans/schema.js";
import * as repo from "../src/modules/plans/repo.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const CODE = "PSU";

function planRow(tenantId: string) {
  return {
    id: randomUUID(),
    tenantId,
    code: CODE,
    name: "PSU Plan",
    edition: "psu" as const,
    maxUsers: 2000,
    maxStorageGb: 500,
    enabledModules: ["finance", "hrms"],
    priceMinor: 4999900n, // paise
    billingCycle: "annual" as const,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  };
}

afterAll(async () => {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () =>
      db.transaction((tx) => tx.delete(plans).where(and(eq(plans.tenantId, t), eq(plans.code, CODE)))),
    );
  }
  await sqlClient.end();
});

describe("GAP2-TENANT-PLANS-UNIQUE-05: plans.code is unique per tenant", () => {
  it("two different tenants can each create a plan with code='PSU'", async () => {
    await runWithTenant(TENANT_A, () => db.transaction((tx) => repo.insert(tx, planRow(TENANT_A))));
    // The second tenant's identical code must NOT violate a global unique.
    await expect(
      runWithTenant(TENANT_B, () => db.transaction((tx) => repo.insert(tx, planRow(TENANT_B)))),
    ).resolves.toBeUndefined();

    const aRows = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(plans).where(and(eq(plans.tenantId, TENANT_A), eq(plans.code, CODE)))),
    );
    const bRows = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => tx.select().from(plans).where(and(eq(plans.tenantId, TENANT_B), eq(plans.code, CODE)))),
    );
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
  });

  it("the same tenant still cannot hold two plans with the same code", async () => {
    await expect(
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.insert(tx, planRow(TENANT_A)))),
    ).rejects.toThrow();
  });
});
