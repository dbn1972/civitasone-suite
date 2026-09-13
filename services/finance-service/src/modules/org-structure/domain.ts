/**
 * ERP Org-Structure domain validation — pure logic + DB checks.
 * Ensures cross-entity consistency (cost center belongs to the same legal entity
 * as the transaction, profit center belongs to same LE, operating unit belongs to same LE).
 */
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { runWithTenant } from "@civitasone/db";
import { legalEntities, operatingUnits, costCenters, profitCenters } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export class OrgValidationError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Verify a legal entity exists and is active for the tenant. */
export async function assertLegalEntityExists(tenantId: string, legalEntityId: string): Promise<void> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select({ id: legalEntities.id }).from(legalEntities)
    .where(and(
      eq(legalEntities.tenantId, tenantId),
      eq(legalEntities.id, legalEntityId),
      eq(legalEntities.isActive, true),
    )).limit(1)));
  if (rows.length === 0) {
    throw new OrgValidationError("LEGAL_ENTITY_NOT_FOUND", `Legal entity ${legalEntityId} not found or inactive for tenant`);
  }
}

/**
 * TX-018 — tenant-scoped sibling of assertLegalEntityExists(). Reads through
 * a caller-supplied transaction handle so an already-open db.transaction()
 * (finance-service gl/consumer.ts's postJournal(), called from all 5 GL
 * posting handlers while inside their own open transaction) does not open a
 * second, bare db.transaction() from inside itself: under pool.max
 * concurrent in-flight consumer transactions, the nested call has no free
 * connection to open on and deadlocks the pool silently. Route every check
 * that happens inside an already-open consumer transaction through this and
 * the other 3 *Tx asserts below, not the non-Tx versions.
 */
export async function assertLegalEntityExistsTx(tx: Writer, tenantId: string, legalEntityId: string): Promise<void> {
  const rows = await tx.select({ id: legalEntities.id }).from(legalEntities)
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
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select({ id: costCenters.id, legalEntityId: costCenters.legalEntityId }).from(costCenters)
    .where(and(
      eq(costCenters.tenantId, tenantId),
      eq(costCenters.id, costCenterId),
      eq(costCenters.isActive, true),
    )).limit(1)));
  if (rows.length === 0) {
    throw new OrgValidationError("COST_CENTER_NOT_FOUND", `Cost center ${costCenterId} not found or inactive`);
  }
  if (rows[0]!.legalEntityId !== legalEntityId) {
    throw new OrgValidationError("COST_CENTER_LE_MISMATCH", `Cost center ${costCenterId} belongs to a different legal entity (expected ${legalEntityId})`);
  }
}

/** TX-018 — tenant-scoped sibling of assertCostCenterBelongsToLE(); see assertLegalEntityExistsTx() above for why this exists. */
export async function assertCostCenterBelongsToLETx(tx: Writer, tenantId: string, costCenterId: string, legalEntityId: string): Promise<void> {
  const rows = await tx.select({ id: costCenters.id, legalEntityId: costCenters.legalEntityId }).from(costCenters)
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
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select({ id: profitCenters.id, legalEntityId: profitCenters.legalEntityId }).from(profitCenters)
    .where(and(
      eq(profitCenters.tenantId, tenantId),
      eq(profitCenters.id, profitCenterId),
      eq(profitCenters.isActive, true),
    )).limit(1)));
  if (rows.length === 0) {
    throw new OrgValidationError("PROFIT_CENTER_NOT_FOUND", `Profit center ${profitCenterId} not found or inactive`);
  }
  if (rows[0]!.legalEntityId !== legalEntityId) {
    throw new OrgValidationError("PROFIT_CENTER_LE_MISMATCH", `Profit center ${profitCenterId} belongs to a different legal entity`);
  }
}

/** TX-018 — tenant-scoped sibling of assertProfitCenterBelongsToLE(); see assertLegalEntityExistsTx() above for why this exists. */
export async function assertProfitCenterBelongsToLETx(tx: Writer, tenantId: string, profitCenterId: string, legalEntityId: string): Promise<void> {
  const rows = await tx.select({ id: profitCenters.id, legalEntityId: profitCenters.legalEntityId }).from(profitCenters)
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
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select({ id: operatingUnits.id, legalEntityId: operatingUnits.legalEntityId }).from(operatingUnits)
    .where(and(
      eq(operatingUnits.tenantId, tenantId),
      eq(operatingUnits.id, operatingUnitId),
      eq(operatingUnits.isActive, true),
    )).limit(1)));
  if (rows.length === 0) {
    throw new OrgValidationError("OPERATING_UNIT_NOT_FOUND", `Operating unit ${operatingUnitId} not found or inactive`);
  }
  if (rows[0]!.legalEntityId !== legalEntityId) {
    throw new OrgValidationError("OPERATING_UNIT_LE_MISMATCH", `Operating unit ${operatingUnitId} belongs to a different legal entity`);
  }
}

/** TX-018 — tenant-scoped sibling of assertOperatingUnitBelongsToLE(); see assertLegalEntityExistsTx() above for why this exists. */
export async function assertOperatingUnitBelongsToLETx(tx: Writer, tenantId: string, operatingUnitId: string, legalEntityId: string): Promise<void> {
  const rows = await tx.select({ id: operatingUnits.id, legalEntityId: operatingUnits.legalEntityId }).from(operatingUnits)
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

/**
 * TX-018 — tenant-scoped sibling of validateOrgAssignment(). Threads the
 * caller's tx through all 4 org-structure asserts instead of each one
 * opening its own transaction; see assertLegalEntityExistsTx() above for why
 * this exists. Route this from postJournal() (gl/consumer.ts), which already
 * has an open tx, instead of validateOrgAssignment().
 */
export async function validateOrgAssignmentTx(
  tx: Writer,
  tenantId: string,
  opts: {
    legalEntityId?: string | null;
    costCenterId?: string | null;
    profitCenterId?: string | null;
    operatingUnitId?: string | null;
  },
): Promise<void> {
  if (!opts.legalEntityId) return; // backward compat: legacy transactions without LE pass through
  await assertLegalEntityExistsTx(tx, tenantId, opts.legalEntityId);
  if (opts.costCenterId) {
    await assertCostCenterBelongsToLETx(tx, tenantId, opts.costCenterId, opts.legalEntityId);
  }
  if (opts.profitCenterId) {
    await assertProfitCenterBelongsToLETx(tx, tenantId, opts.profitCenterId, opts.legalEntityId);
  }
  if (opts.operatingUnitId) {
    await assertOperatingUnitBelongsToLETx(tx, tenantId, opts.operatingUnitId, opts.legalEntityId);
  }
}
