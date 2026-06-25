import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });

export const createTicketBody = z.object({
  citizenId:   z.string().uuid().optional(),
  // P1-7: capped + sanitised free text.
  subject:     safeText({ max: 200 }),
  description: safeText({ max: 5000, multiline: true }),
  priority:    z.enum(["low", "medium", "high", "critical"]).optional(),
  category:    safeText({ max: 64 }).optional(),
  channel:     z.enum(["web", "email", "phone", "walk_in"]).optional(),
});
export type CreateTicketBody = z.infer<typeof createTicketBody>;

export const assignTicketBody = z.object({
  assigneeId: z.string().uuid(),
});
export type AssignTicketBody = z.infer<typeof assignTicketBody>;

export const resolveTicketBody = z.object({
  note: safeText({ max: 2000, multiline: true }).optional(),
});
export type ResolveTicketBody = z.infer<typeof resolveTicketBody>;

export const escalateTicketBody = z.object({
  reason: safeText({ max: 1000, multiline: true }),
});
export type EscalateTicketBody = z.infer<typeof escalateTicketBody>;

export const ticketNoteBody = z.object({
  body: safeText({ max: 2000, multiline: true }),
});
export type TicketNoteBody = z.infer<typeof ticketNoteBody>;

export const closeTicketBody = z.object({
  note: safeText({ max: 2000, multiline: true }).optional(),
});
export type CloseTicketBody = z.infer<typeof closeTicketBody>;
