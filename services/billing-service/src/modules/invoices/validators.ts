import { z } from "zod";

export const generateBody = z.object({
  tenantId: z.string().uuid(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

export const idParam = z.object({ id: z.string().uuid() });
export const tenantParam = z.object({ id: z.string().uuid() });
