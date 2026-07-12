/**
 * ERP Org-Structure validation tests.
 * Verifies: legal entity CRUD, cost center belongs-to-LE enforcement,
 * profit center belongs-to-LE enforcement, cross-entity mismatch rejection.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { legalEntities, operatingUnits, costCenters, profitCenters, purchasingOrgs } from "../src/modules/org-structure/schema.js";
import { scoped } from "./_tenant.js";
import {
  validateOrgAssignment, assertCostCenterBelongsToLE,
  assertLegalEntityExists, OrgValidationError,
} from "../src/modules/org-structure/domain.js";

const TENANT = "c1111111-aaaa-4000-8000-000000000001";
const ACTOR  = "00000000-aaaa-4000-8000-000000000099";
const LE_A   = randomUUID();
const LE_B   = randomUUID();

async function clean() {
  await scoped(TENANT, (tx) => tx.delete(purchasingOrgs).where(eq(purchasingOrgs.tenantId, TENANT)));
  await scoped(TENANT, (tx) => tx.delete(profitCenters).where(eq(profitCenters.tenantId, TENANT)));
  await scoped(TENANT, (tx) => tx.delete(costCenters).where(eq(costCenters.tenantId, TENANT)));
  await scoped(TENANT, (tx) => tx.delete(operatingUnits).where(eq(operatingUnits.tenantId, TENANT)));
  await scoped(TENANT, (tx) => tx.delete(legalEntities).where(eq(legalEntities.tenantId, TENANT)));
}

async function seedOrg() {
  await scoped(TENANT, (tx) => tx.insert(legalEntities).values([
    { id: LE_A, tenantId: TENANT, code: "LE-A", name: "Entity A", entityType: "company", currency: "INR", fiscalYearStart: "04-01", createdBy: ACTOR, updatedBy: ACTOR },
    { id: LE_B, tenantId: TENANT, code: "LE-B", name: "Entity B", entityType: "subsidiary", currency: "INR", fiscalYearStart: "04-01", createdBy: ACTOR, updatedBy: ACTOR },
  ]));
}

beforeEach(async () => { await clean(); await seedOrg(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("ERP Org-Structure — Legal Entity", () => {
  it("assertLegalEntityExists passes for active entity", async () => {
    await expect(assertLegalEntityExists(TENANT, LE_A)).resolves.toBeUndefined();
  });

  it("assertLegalEntityExists rejects unknown entity", async () => {
    await expect(assertLegalEntityExists(TENANT, randomUUID()))
      .rejects.toThrow("not found or inactive");
  });
});

describe("ERP Org-Structure — Cost Center belongs to Legal Entity", () => {
  it("passes when cost center belongs to the same LE", async () => {
    const ccId = randomUUID();
    await scoped(TENANT, (tx) => tx.insert(costCenters).values({
      id: ccId, tenantId: TENANT, legalEntityId: LE_A, code: "CC-001", name: "Admin Cost Center",
      createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await expect(assertCostCenterBelongsToLE(TENANT, ccId, LE_A)).resolves.toBeUndefined();
  });

  it("rejects when cost center belongs to a DIFFERENT LE", async () => {
    const ccId = randomUUID();
    await scoped(TENANT, (tx) => tx.insert(costCenters).values({
      id: ccId, tenantId: TENANT, legalEntityId: LE_B, code: "CC-002", name: "Entity B CC",
      createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await expect(assertCostCenterBelongsToLE(TENANT, ccId, LE_A))
      .rejects.toThrow("belongs to a different legal entity");
  });
});

describe("ERP Org-Structure — Full validateOrgAssignment", () => {
  it("passes with valid LE + cost center + profit center + operating unit", async () => {
    const ccId = randomUUID();
    const pcId = randomUUID();
    const ouId = randomUUID();
    await scoped(TENANT, (tx) => tx.insert(costCenters).values({ id: ccId, tenantId: TENANT, legalEntityId: LE_A, code: "CC-10", name: "CC10", createdBy: ACTOR, updatedBy: ACTOR }));
    await scoped(TENANT, (tx) => tx.insert(profitCenters).values({ id: pcId, tenantId: TENANT, legalEntityId: LE_A, code: "PC-10", name: "PC10", createdBy: ACTOR, updatedBy: ACTOR }));
    await scoped(TENANT, (tx) => tx.insert(operatingUnits).values({ id: ouId, tenantId: TENANT, legalEntityId: LE_A, code: "OU-10", name: "OU10", unitType: "branch", createdBy: ACTOR, updatedBy: ACTOR }));

    await expect(validateOrgAssignment(TENANT, {
      legalEntityId: LE_A, costCenterId: ccId, profitCenterId: pcId, operatingUnitId: ouId,
    })).resolves.toBeUndefined();
  });

  it("skips validation when legalEntityId is null (backward compat)", async () => {
    await expect(validateOrgAssignment(TENANT, {
      legalEntityId: null, costCenterId: randomUUID(),
    })).resolves.toBeUndefined();
  });

  it("rejects when any org ref belongs to wrong LE", async () => {
    const ccId = randomUUID();
    await scoped(TENANT, (tx) => tx.insert(costCenters).values({ id: ccId, tenantId: TENANT, legalEntityId: LE_B, code: "CC-X", name: "Wrong LE CC", createdBy: ACTOR, updatedBy: ACTOR }));

    await expect(validateOrgAssignment(TENANT, {
      legalEntityId: LE_A, costCenterId: ccId,
    })).rejects.toThrow("belongs to a different legal entity");
  });
});

describe("ERP Org-Structure — Purchasing Org", () => {
  it("stores a purchasing org linked to a legal entity", async () => {
    const poId = randomUUID();
    await scoped(TENANT, (tx) => tx.insert(purchasingOrgs).values({
      id: poId, tenantId: TENANT, legalEntityId: LE_A, code: "PO-001",
      name: "Central Procurement", scope: "entity", createdBy: ACTOR, updatedBy: ACTOR,
    }));
    const rows = await scoped(TENANT, (tx) => tx.select().from(purchasingOrgs).where(eq(purchasingOrgs.id, poId)));
    expect(rows[0]?.legalEntityId).toBe(LE_A);
    expect(rows[0]?.scope).toBe("entity");
  });
});
