import { z } from "zod";

/** Paise amount: non-negative integer minor units. */
const amountMinor = z.number().int().nonnegative();

/**
 * Body schema for POST /v1/payroll/tax-declarations.
 *
 * `employeeId` is optional here because ownership/authorisation is resolved by
 * `enforceEmployeeOwnership` (self-service employees are pinned to their own id;
 * privileged roles must supply a target id). `fy` format is checked here and
 * further validated by `parseFy` at the route (suffix == (startYear+1) % 100).
 */
export const createTaxDeclarationBody = z.object({
  employeeId:              z.string().uuid().optional(),
  fy:                      z.string().regex(/^\d{4}-\d{2}$/, "fy must be in format YYYY-YY e.g. 2025-26"),
  regime:                  z.enum(["old", "new"]).optional(),
  section80c:              amountMinor.default(0),
  section80d:              amountMinor.default(0),
  otherDeductions:         amountMinor.default(0),
  rentPaidMinor:           amountMinor.default(0),
  prevEmployerSalaryMinor: amountMinor.optional(),
  otherSourcesIncomeMinor: amountMinor.optional(),
  perquisitesMinor:        amountMinor.optional(),
});
export type CreateTaxDeclarationBody = z.infer<typeof createTaxDeclarationBody>;
