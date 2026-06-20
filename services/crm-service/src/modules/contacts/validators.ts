/** zod validators — applied at the route boundary (CLAUDE.md §3: no raw req.body). */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createContactBody = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320).optional(),
  phone: z.string().min(3).max(32).optional(),
  company: z.string().min(1).max(200).optional(),
});
export type CreateContactBody = z.infer<typeof createContactBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const contactViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const contactsListSchema = paginatedSchema(contactViewSchema);
