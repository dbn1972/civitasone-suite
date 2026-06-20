/** zod validators — applied at the route boundary. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createCallBody = z.object({
  name: z.string().min(1).max(200),
  callerNumber: z.string().min(3).max(32).optional(),
});
export type CreateCallBody = z.infer<typeof createCallBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const callViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  callerNumber: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const callsListSchema = paginatedSchema(callViewSchema);
