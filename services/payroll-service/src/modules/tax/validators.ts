import { z } from "zod";

/** Paise amount: non-negative integer minor units. */
const amountMinor = z.number().int().nonnegative();

/**
 * Body schema for POST /v1/payroll/tax-declarations.
 *
 * `employeeId` is optional here because ownership/authorisation is resolved by
 * `scopeEmployeeId` (self-service employees are pinned to their own id;
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
  /** Form 12BB landlord details (GAP-PAYROLL-TAX-DECLARATION-02). Blank/omitted = keep what is stored. */
  landlordName:            z.string().trim().max(128).optional(),
  landlordPan:             z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "landlordPan must be a valid PAN (ABCDE1234F)").optional(),
});

/** Annual rent above this (paise, Rs 1,00,000) needs the landlord's PAN (Form 12BB / HRA proof rule). */
export const LANDLORD_PAN_RENT_THRESHOLD_MINOR = 10_000_000;

export const taxDeclarationWindowBody = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/, "fy must be in format YYYY-YY e.g. 2025-26"),
  opensOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  changeReason: z.string().trim().min(10).max(500),
}).refine((b) => !b.opensOn || b.opensOn <= b.closesOn, { message: "opensOn must not be after closesOn", path: ["opensOn"] });
export type TaxDeclarationWindowBody = z.infer<typeof taxDeclarationWindowBody>;
export type CreateTaxDeclarationBody = z.infer<typeof createTaxDeclarationBody>;
