import { z } from "zod";
import { zNonNegMoneyMinor, zPositiveMoneyMinor } from "../../shared/validators.js";

// Column capacities in schema.ts: quantity numeric(18,4) (< 1e14), the optional dimension values numeric(12,4)
// (|v| <= 99999999.9999). A value beyond them used to pass validation and fail inside the consumer after the 202.
const MAX_QUANTITY_EXCLUSIVE = 1e14;
const MAX_DIMENSION = 99999999.9999;
const dimension = z.number().finite().gte(-MAX_DIMENSION).lte(MAX_DIMENSION);

export const issueMbSchema = z.object({
  workId: z.string().uuid(),
  awardId: z.string().uuid(),
  mbNumber: z.string().min(1).max(64),
});

export const recordMeasurementSchema = z.object({
  mbId: z.string().uuid(),
  boqItemId: z.string().uuid(),
  quantity: z.number().positive().finite().lt(MAX_QUANTITY_EXCLUSIVE),
  numberVal: dimension.optional(),
  lengthVal: dimension.optional(),
  breadthVal: dimension.optional(),
  depthVal: dimension.optional(),
  remarks: z.string().max(2048).optional(),
});

export const finalizeMbSchema = z.object({
  id: z.string().uuid(),
  nextStatus: z.enum(["so_finalized", "sdo_finalized", "estimator_finalized", "do_finalized"]),
});

export const createBillSchema = z.object({
  workId: z.string().uuid(),
  awardId: z.string().uuid(),
  // No-3-way-match fix: every bill (abstract or e_mb) must be backed by a
  // real, finalized measurement-book entry — mbId is no longer optional.
  // See billing/routes.ts and billing/consumer.ts for the full chain this
  // now enforces: mb belongs to the same work+award, mb is do_finalized,
  // and the bill's gross amount does not exceed the mb's measured value.
  mbId: z.string().uuid(),
  billMode: z.enum(["abstract", "e_mb"]),
  // Trimmed so the stored value is exactly what the per-work uniqueness check compares.
  billNumber: z.string().trim().min(1).max(64),
  // A bill's gross is strictly positive (a zero or negative gross sailed through both cumulative ceiling checks);
  // deductions may be zero (none) but never negative. Net payable stays gross - deductions (an overpayment recovery
  // can still make it negative, see billing-domain.test.ts).
  grossAmountMinor: zPositiveMoneyMinor,
  deductionsMinor: zNonNegMoneyMinor.optional(),
});

export const finalizeBillSchema = z.object({
  id: z.string().uuid(),
  nextStatus: z.enum(["so_finalized", "sdo_finalized", "auditor_finalized", "dao_finalized", "do_finalized"]),
});

export const compileAccountSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  submittedTo: z.string().max(256).optional(),
});

/**
 * GAP-WORKS-BILLING-ACCOUNT-COMPILE-03: query validator for the
 * "already compiled?" check. Query params arrive as strings, so coerce.
 */
export const listAccountCompileSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});
