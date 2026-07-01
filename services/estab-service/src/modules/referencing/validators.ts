import { z } from "zod";
import { REFERENCE_TYPES } from "./domain.js";

export const addReferenceBody = z.object({
  fileId:       z.string().uuid(),
  noteId:       z.string().uuid().nullable().default(null),
  refType:      z.enum(REFERENCE_TYPES),
  refValue:     z.string().min(1).max(1000),
  label:        z.string().min(1).max(500).optional(),
  targetFileId: z.string().uuid().nullable().default(null),
  pageFrom:     z.number().int().min(1).optional(),
  pageTo:       z.number().int().min(1).optional(),
});
export type AddReferenceBody = z.infer<typeof addReferenceBody>;

export const removeReferenceBody = z.object({
  referenceId: z.string().uuid(),
});
export type RemoveReferenceBody = z.infer<typeof removeReferenceBody>;
