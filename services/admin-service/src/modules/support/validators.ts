import { z } from "zod";

export const breakGlassBody = z.object({
  tenantId: z.string().uuid(),
  ticketId: z.string().uuid(),
  reason: z.string().min(10).max(1000),
});

export const closeParam = z.object({ id: z.string().uuid() });
