import { z } from "zod";

export const createShareBody = z.object({
  fileId:     z.string().uuid(),
  sharedWith: z.string().uuid(),
  permission: z.enum(["read", "edit", "admin"]).default("read"),
});
export type CreateShareBody = z.infer<typeof createShareBody>;
