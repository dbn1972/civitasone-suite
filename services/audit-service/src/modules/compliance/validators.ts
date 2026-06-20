import { z } from "zod";

export const pendingQuery = z.object({
  status: z.enum(["pending", "resolved", "overdue"]).default("pending"),
});
