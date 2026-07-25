import { z } from "zod";
import { DOC_TYPES } from "./docs-domain.js";

export const addDocBody = z.object({
  docType:   z.enum(DOC_TYPES).default("other"),
  title:     z.string().min(1).max(256),
  storageRef:z.string().min(1).max(1024),
  mimeType:  z.string().max(128).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type AddDocBody = z.infer<typeof addDocBody>;

export const createCorrigendumBody = z.object({
  title:             z.string().min(1).max(256),
  description:       z.string().max(2000).optional(),
  storageRef:        z.string().max(1024).optional(),
  newBidClosingDate: z.string().optional(),
});
export type CreateCorrigendumBody = z.infer<typeof createCorrigendumBody>;

export const republishCorrigendumBody = z.object({
  notes: z.string().max(500).optional(),
});
export type RepublishCorrigendumBody = z.infer<typeof republishCorrigendumBody>;

export const createPrebidQueryBody = z.object({
  question: z.string().min(3).max(2000),
  vendorId: z.string().uuid().optional(),
});
export type CreatePrebidQueryBody = z.infer<typeof createPrebidQueryBody>;

export const answerPrebidQueryBody = z.object({
  answer: z.string().min(1).max(2000),
});
export type AnswerPrebidQueryBody = z.infer<typeof answerPrebidQueryBody>;

export const tenderIdParam = z.object({ id: z.string().uuid() });
export const corrigendumIdParam = z.object({ id: z.string().uuid(), corrigendumId: z.string().uuid() });
export const queryIdParam = z.object({ id: z.string().uuid(), queryId: z.string().uuid() });
