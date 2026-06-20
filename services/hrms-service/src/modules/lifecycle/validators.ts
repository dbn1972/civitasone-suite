import { z } from "zod";

export const transferBody = z.object({
  fromDeptId:    z.string().uuid(),
  toDeptId:      z.string().uuid(),
  fromDesigId:   z.string().uuid().optional(),
  toDesigId:     z.string().uuid().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  orderRef:      z.string().max(128).optional(),
});
export type TransferBody = z.infer<typeof transferBody>;

export const separateBody = z.object({
  separationType: z.enum(["resignation", "retirement", "termination", "vrs", "death"]),
  effectiveDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastWorkingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  encashmentDays:  z.number().int().nonnegative().default(0),
  remarks:         z.string().max(1000).optional(),
});
export type SeparateBody = z.infer<typeof separateBody>;

export const idParam = z.object({ id: z.string().uuid() });
