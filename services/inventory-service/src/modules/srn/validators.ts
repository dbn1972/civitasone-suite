/** zod validators — applied at the route boundary for Store Receipt Note (SRN) operations. */
import { z } from "zod";

export const srnStatus = z.enum(["draft", "signed"]);

export const createSrnBody = z.object({
  grnId:   z.string().uuid(),
  remarks: z.string().max(1000).optional(),
});
export type CreateSrnBody = z.infer<typeof createSrnBody>;

export const signSrnBody = z.object({
  receivedAt: z.string().datetime().optional(),
  remarks:    z.string().max(1000).optional(),
});
export type SignSrnBody = z.infer<typeof signSrnBody>;

export const idParam = z.object({ id: z.string().uuid() });
export const grnIdParam = z.object({ grnId: z.string().uuid() });
