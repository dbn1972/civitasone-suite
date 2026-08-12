import { z } from "zod";

export const createFolderBody = z.object({
  name:     z.string().min(1).max(500),
  parentId: z.string().uuid().optional(),
});
export type CreateFolderBody = z.infer<typeof createFolderBody>;

export const renameFolderBody = z.object({ name: z.string().min(1).max(500) });
export const moveFolderBody   = z.object({ parentId: z.string().uuid().nullable() });
