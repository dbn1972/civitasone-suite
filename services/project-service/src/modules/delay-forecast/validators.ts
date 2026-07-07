import { z } from "zod";

export const projectIdParam = z.object({
  projectId: z.string().uuid(),
});
