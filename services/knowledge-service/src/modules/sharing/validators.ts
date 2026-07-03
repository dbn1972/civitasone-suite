import { z } from "zod";

export const createShareBody = z.object({
  documentId: z.string().uuid(),
  sharedWith: z.string().uuid(),
  permission: z.enum(["view", "edit"]),
  expiresAt: z.string().datetime().optional(),
});
export type CreateShareBody = z.infer<typeof createShareBody>;

export const revokeShareBody = z.object({
  shareId: z.string().uuid(),
});
export type RevokeShareBody = z.infer<typeof revokeShareBody>;
