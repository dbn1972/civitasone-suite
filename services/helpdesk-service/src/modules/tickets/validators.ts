import { z } from "zod";
import { ticketsListSchema } from "@civitasone/schemas/web";

/** CS-001 — valid intake channels for helpdesk tickets. */
export const VALID_CHANNELS = ["phone", "email", "portal", "chatbot", "whatsapp", "api", "manual"] as const;
export type Channel = (typeof VALID_CHANNELS)[number];

export const createTicketBody = z.object({
  subject: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
  // ITIL ticket type — optional for backward compatibility (legacy tickets have no type).
  ticketType: z.enum(["incident", "problem", "change"]).optional(),
  // Type-specific required fields.
  typeFields: z.record(z.unknown()).optional(),
  // CMDB asset linkage — optional list of asset IDs.
  assetIds: z.array(z.string().uuid()).optional(),
  // CS-001 — intake channel (required for multi-channel case creation).
  channel: z.enum(VALID_CHANNELS).optional(),
  // CS-001 — category classification (optional FK to helpdesk.categories).
  categoryId: z.string().uuid().optional(),
});
export type CreateTicketBody = z.infer<typeof createTicketBody>;

export const transitionTicketBody = z.object({
  status: z.string().min(1),
});
export type TransitionTicketBody = z.infer<typeof transitionTicketBody>;

export const assignTicketBody = z.object({
  assigneeId: z.string().uuid(),
});
export type AssignTicketBody = z.infer<typeof assignTicketBody>;

export const idParam = z.object({ id: z.string().uuid() });

export { ticketsListSchema };
