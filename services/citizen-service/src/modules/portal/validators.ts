import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const tenantQuery = z.object({ tenantId: z.string().uuid() });

export const createProfileBody = z.object({
  name:            z.string().min(1),
  email:           z.string().email().optional(),
  mobile:          z.string().min(10).max(16).optional(),
  digilockerToken: z.string().optional(),
  address:         z.string().optional(),
  ward:            z.string().optional(),
});
export type CreateProfileBody = z.infer<typeof createProfileBody>;
