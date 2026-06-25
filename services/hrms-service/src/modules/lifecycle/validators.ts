import { z } from "zod";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// transferBody is the shared shape consumed by employee/commands.ts
// (employeeId comes from the URL there) — DO NOT add employeeId here.
export const transferBody = z.object({
  fromDeptId:    z.string().uuid(),
  toDeptId:      z.string().uuid(),
  fromDesigId:   z.string().uuid().optional(),
  toDesigId:     z.string().uuid().optional(),
  effectiveDate: DATE,
  orderRef:      z.string().max(128).optional(),
});
export type TransferBody = z.infer<typeof transferBody>;

// Lifecycle transfer-order creation carries employeeId + stations in the body.
export const createTransferBody = transferBody.extend({
  employeeId:  z.string().uuid(),
  fromStation: z.string().max(128).optional(),
  toStation:   z.string().max(128).optional(),
});
export type CreateTransferBody = z.infer<typeof createTransferBody>;

export const issueOrderBody = z.object({
  orderNo:   z.string().min(1).max(64),
  orderDate: DATE,
  orderRef:  z.string().max(128).optional(),
});
export const relieveBody = z.object({ relievedDate: DATE });
export const joinBody = z.object({ joinedDate: DATE });

export const separateBody = z.object({
  separationType: z.enum(["resignation", "retirement", "termination", "vrs", "death"]),
  effectiveDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastWorkingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  encashmentDays:  z.number().int().nonnegative().default(0),
  remarks:         z.string().max(1000).optional(),
});
export type SeparateBody = z.infer<typeof separateBody>;

export const idParam = z.object({ id: z.string().uuid() });

// Promotion creation — validated (replaces prior raw body casts in routes.ts).
export const createPromotionBody = z.object({
  employeeId:    z.string().uuid(),
  fromDesigId:   z.string().uuid(),
  toDesigId:     z.string().uuid(),
  effectiveDate: DATE,
  orderRef:      z.string().max(128).optional(),
  newBasicMinor: z.number().int().positive().max(1_000_000_00).optional(),
});
export type CreatePromotionBody = z.infer<typeof createPromotionBody>;
