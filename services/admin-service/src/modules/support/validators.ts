import { z } from "zod";

export const breakGlassBody = z.object({
  tenantId: z.string().uuid(),
  ticketId: z.string().uuid(),
  reason: z.string().min(10).max(1000),
});

export const closeParam = z.object({ id: z.string().uuid() });

// P1-3: optional target tenant for platform-wide break-glass review (super_admin).
export const breakGlassListQuery = z.object({
  tenantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
