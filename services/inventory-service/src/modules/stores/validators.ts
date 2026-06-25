import { z } from "zod";

export const createStoreBody = z.object({
  name:     z.string().min(1).max(200),
  code:     z.string().min(1).max(64),
  location: z.string().max(256).optional(),
});
export type CreateStoreBody = z.infer<typeof createStoreBody>;

export const createStorePayload = createStoreBody.extend({
  id:       z.string().uuid(),
  tenantId: z.string().uuid(),
});

export const storeQueryParams = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
