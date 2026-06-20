import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createTicketBody = z.object({
  citizenId:   z.string().uuid(),
  subject:     z.string().min(1),
  description: z.string().min(1),
});
export type CreateTicketBody = z.infer<typeof createTicketBody>;

export const ticketNoteBody = z.object({
  body: z.string().min(1),
});
export type TicketNoteBody = z.infer<typeof ticketNoteBody>;

export const closeTicketBody = z.object({
  note: z.string().optional(),
});
export type CloseTicketBody = z.infer<typeof closeTicketBody>;
