import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createInstanceBody = z.object({
  name: z.string().min(1).max(200),
  definitionCode: z.string().min(1).max(64).optional(),
  refType: z.string().min(1).max(64).optional(),
  refId: z.string().uuid().optional(),
  context: z.record(z.unknown()).optional(),
});
export type CreateInstanceBody = z.infer<typeof createInstanceBody>;

export const instanceViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  version: z.number().int(),
});

export const instancesListSchema = paginatedSchema(instanceViewSchema);
