import { z } from "zod";

export const generateBillBody = z.object({
  assessmentId: z.string().uuid(),
});
