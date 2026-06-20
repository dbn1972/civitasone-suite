import { z } from "zod";

export const createObservationBody = z.object({
  obsNo:               z.string().min(1).max(64),
  planId:              z.string().uuid().optional(),
  auditeeRef:          z.string().min(1).max(128),
  finding:             z.string().min(1).max(4000),
  category:            z.enum(["performance", "compliance", "financial"]).default("compliance"),
  riskLevel:           z.enum(["low", "medium", "high"]).default("medium"),
  amountInvolvedMinor: z.number().int().nonnegative().default(0),
});
export type CreateObservationBody = z.infer<typeof createObservationBody>;

export const draftParaBody = z.object({
  paraNo:   z.string().min(1).max(64),
  deptRef:  z.string().min(1).max(128),
  body:     z.string().min(1).max(8000),
  sourceRef: z.string().max(256).optional(),
});
export type DraftParaBody = z.infer<typeof draftParaBody>;

export const idParam = z.object({ id: z.string().uuid() });
