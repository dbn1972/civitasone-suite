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
  // GAP-WORKFLOW-LIST-03 — optional subject/definition/step/date fields so the
  // list can show what an instance is about, where it is and how old it is.
  // Optional so the slim detail/other producers remain valid.
  definitionId: z.string().uuid().nullable().optional(),
  definitionCode: z.string().nullable().optional(),
  definitionName: z.string().nullable().optional(),
  refType: z.string().nullable().optional(),
  refId: z.string().nullable().optional(),
  currentNode: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});

export const instancesListSchema = paginatedSchema(instanceViewSchema);
