import { z } from "zod";

export const createStructureBody = z.object({
  name:        z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  isDefault:   z.boolean().default(false),
});
export type CreateStructureBody = z.infer<typeof createStructureBody>;

export const createRunBody = z.object({
  runNo:        z.string().min(1).max(64),
  month:        z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM"),
  departmentId: z.string().uuid().optional(),
  structureId:  z.string().uuid(),
});
export type CreateRunBody = z.infer<typeof createRunBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const slipQueryParams = z.object({
  runId: z.string().uuid().optional(),
});
