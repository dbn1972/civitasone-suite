/** CM-002 zod validators — account-to-account relationships / groups. */
import { z } from "zod";

export const REL_TYPES = ["parent", "subsidiary", "group", "branch", "partner", "affiliate"] as const;

export const createRelationshipBody = z.object({
  toAccountId: z.string().uuid(),
  relType: z.enum(REL_TYPES),
});
export type CreateRelationshipBody = z.infer<typeof createRelationshipBody>;

export const accountIdParam = z.object({ id: z.string().uuid() });
export const relIdParam = z.object({ id: z.string().uuid(), relId: z.string().uuid() });
