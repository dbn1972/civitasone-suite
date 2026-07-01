/**
 * ERP Org-Structure domain validation — pure logic + DB checks.
 * Ensures cross-entity consistency (cost center belongs to the same legal entity
 * as the transaction, profit center belongs to same LE, operating unit belongs to same LE).
 */
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalEntities, operatingUnits, costCenters, profitCenters } from "./schema.js";

export class OrgValidationError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Verify a legal entity exists and is active for the tenant. */
export async function assertLegalEntityExists(tenantId: string, legalEntityId: string): Promise<void> {
  const rows = await db.select({ id: legalEntities.id }).from(legalEntities)
    .where(and(
      eq(legalEntities.tenantId, tenantId),
      eq(legalEntities.id, legalEntityId),
      eq(legalEntities.isActive, true),
    )).limit(1);
  if (rows.length === 0) {
    throw new OrgValidationError("LEGAL_ENTITY_NOT_FOUND", `Legal entity ${legalEntityId} not found or inactive for tenant`);
  }
}

/** Verify a cost center belongs to the specified legal entity. */
export async function assertCostCenterBelongsToLE(tenantId: string, costCenterId: string, legalEntityId: string): Promise<void> {
  const rows = await db.select({ id: costCenters.id, legalEntityId: costCenters.legalEntityId }).from(costCenters)
    .where(and(
      eq(costCenters.tenantId, tenantId),
      eq(costCenters.id, costCenterId),
      eq(costCenters.isActive, true),
    )).limit(1);
  if (rows.length === 0) {
    throw new OrgValidationError("COST_CENTER_NOT_FOUND", `Cost center ${costCenterId} not found or inactive`);
  }
  if (rows[0]!.legalEntityId !== legalEntityId) {
    throw new OrgValidationError("COST_CENTER_LE_MISMATCH", `Cost center ${costCenterId} belongs to a different legal entity (expected ${legalEntityId})`);
  }
}

/** Verify a profit center belongs to the specified legal entity. */
export async function assertProfitCenterBelongsToLE(tenantId: string, profitCenterId: string, legalEntityId: string): Promise<void> {
  const rows = await db.select({ id: profitCenters.id, legalEntityId: profitCenters.legalEntityId }).from(profitCenters)
    .where(and(
      eq(profitCenters.tenantId, tenantId),
      eq(profitCenters.id, profitCenterId),
      eq(profitCenters.isActive, true),
    )).limit(1);
  if (rows.length === 0) {
    throw new OrgValidationError("PROFIT_CENTER_NOT_FOUND", `Profit center ${profitCenterId} not found or inactive`);
  }
  if (rows[0]!.legalEntityId !== legalEntityId) {
    throw new OrgValidationError("PROFIT_CENTER_LE_MISMATCH", `Profit center ${profitCenterId} belongs to a different legal entity`);
  }
}

/** Verify an operating unit belongs to the specified legal entity. */
export async function assertOperatingUnitBelongsToLE(tenantId: string, operatingUnitId: string, legalEntityId: string): Promise<void> {
  const rows = await db.select({ id: operatingUnits.id, legalEntityId: operatingUnits.legalEntityId }).from(operatingUnits)
    .where(and(
      eq(operatingUnits.tenantId, tenantId),
      eq(operatingUnits.id, operatingUnitId),
      eq(operatingUnits.isActive, true),
    )).limit(1);
  if (rows.length === 0) {
    throw new OrgValidationError("OPERATING_UNIT_NOT_FOUND", `Operating unit ${operatingUnitId} not found or inactive`);
  }
  if (rows[0]!.legalEntityId !== legalEntityId) {
    throw new OrgValidationError("OPERATING_UNIT_LE_MISMATCH", `Operating unit ${operatingUnitId} belongs to a different legal entity`);
  }
}

/**
 * Full org-structure validation for a financial transaction.
 * If a legal_entity_id is supplied, validates all org refs belong to it.
 * If no legal_entity_id is supplied, the validation is skipped (backward-compat).
 */
export async function validateOrgAssignment(
  tenantId: string,
  opts: {
    legalEntityId?: string | null;
    costCenterId?: string | null;
    profitCenterId?: string | null;
    operatingUnitId?: string | null;
  },
): Promise<void> {
  if (!opts.legalEntityId) return; // backward compat: legacy transactions without LE pass through
  await assertLegalEntityExists(tenantId, opts.legalEntityId);
  if (opts.costCenterId) {
    await assertCostCenterBelongsToLE(tenantId, opts.costCenterId, opts.legalEntityId);
  }
  if (opts.profitCenterId) {
    await assertProfitCenterBelongsToLE(tenantId, opts.profitCenterId, opts.legalEntityId);
  }
  if (opts.operatingUnitId) {
    await assertOperatingUnitBelongsToLE(tenantId, opts.operatingUnitId, opts.legalEntityId);
  }
}
