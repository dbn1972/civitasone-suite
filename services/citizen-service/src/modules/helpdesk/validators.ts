import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createTicketBody = z.object({
  citizenId:   z.string().uuid().optional(),
  subject:     z.string().min(1),
  description: z.string().min(1),
  priority:    z.enum(["low", "medium", "high", "critical"]).optional(),
  category:    z.string().max(64).optional(),
  channel:     z.enum(["web", "email", "phone", "walk_in"]).optional(),
});
export type CreateTicketBody = z.infer<typeof createTicketBody>;

export const assignTicketBody = z.object({
  assigneeId: z.string().uuid(),
});
export type AssignTicketBody = z.infer<typeof assignTicketBody>;

export const resolveTicketBody = z.object({
  note: z.string().optional(),
});
export type ResolveTicketBody = z.infer<typeof resolveTicketBody>;

export const escalateTicketBody = z.object({
  reason: z.string().min(1).max(1000),
});
export type EscalateTicketBody = z.infer<typeof escalateTicketBody>;

export const ticketNoteBody = z.object({
  body: z.string().min(1),
});
export type TicketNoteBody = z.infer<typeof ticketNoteBody>;

export const closeTicketBody = z.object({
  note: z.string().optional(),
});
export type CloseTicketBody = z.infer<typeof closeTicketBody>;
