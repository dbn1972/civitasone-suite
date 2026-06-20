import { z } from "zod";

export const createSubBody = z.object({
  tenantId: z.string().uuid(),
  planId: z.string().uuid(),
});

export const idParam = z.object({ id: z.string().uuid() });
export const tenantParam = z.object({ id: z.string().uuid() });
