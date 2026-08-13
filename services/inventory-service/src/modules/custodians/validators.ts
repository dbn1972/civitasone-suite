import { z } from "zod";

export const createCustodianBody = z.object({
  storeId:       z.string().uuid(),
  employeeRef:   z.string().uuid(),
  designation:   z.string().min(1).max(120).optional(),
  effectiveFrom: z.string().date(),
  effectiveTo:   z.string().date().optional(),
});
export type CreateCustodianBody = z.infer<typeof createCustodianBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const custodianQueryParams = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
