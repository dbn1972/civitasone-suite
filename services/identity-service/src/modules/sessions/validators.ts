import { z } from "zod";

export const createSessionBody = z.object({
  tenantId:  z.string().uuid(),
  userId:    z.string().uuid(),
  ip:        z.string().max(45),
  device:    z.string().max(256).optional(),
  mfaMethod: z.string().max(32).optional(),
  trusted:   z.boolean().default(false),
  ttlSeconds: z.number().int().min(60).max(86400 * 30).default(3600),
});
export type CreateSessionBody = z.infer<typeof createSessionBody>;

export const sessionIdParam = z.object({ id: z.string().uuid() });
