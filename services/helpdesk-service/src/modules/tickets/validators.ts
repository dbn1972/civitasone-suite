import { z } from "zod";
import { ticketsListSchema } from "@civitasone/schemas/web";

export const createTicketBody = z.object({
  subject: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
});
export type CreateTicketBody = z.infer<typeof createTicketBody>;

export const idParam = z.object({ id: z.string().uuid() });

export { ticketsListSchema };
