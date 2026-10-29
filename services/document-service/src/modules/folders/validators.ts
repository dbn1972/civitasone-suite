import { z } from "zod";

/** "/" separates the levels of a folder's name path (repo.ts namePath), so it cannot appear in a name. */
const folderName = z.string().trim().min(1).max(500).refine((n) => !n.includes("/"), { message: "folder name must not contain '/'" });

export const createFolderBody = z.object({
  name:     folderName,
  parentId: z.string().uuid().optional(),
});
export type CreateFolderBody = z.infer<typeof createFolderBody>;

export const renameFolderBody = z.object({ name: folderName });
export const moveFolderBody   = z.object({ parentId: z.string().uuid().nullable() });
