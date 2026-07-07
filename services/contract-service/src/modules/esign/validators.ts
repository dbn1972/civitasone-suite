import { z } from "zod";

const signatorySchema = z.object({
  userId: z.string().uuid(),
  ordinal: z.number().int().min(1).max(10),
  deadlineDays: z.number().int().min(1).max(30),
});

export const createEsignRouteBody = z.object({
  contractId: z.string().uuid(),
  ownerId: z.string().uuid(),
  signatories: z
    .array(signatorySchema)
    .min(1, "at least 1 signatory required")
    .max(10, "at most 10 signatories allowed"),
});

export type CreateEsignRouteBody = z.infer<typeof createEsignRouteBody>;

export const esignRouteIdParam = z.object({
  id: z.string().uuid(),
});

export const signBody = z.object({
  userId: z.string().uuid(),
});

export type SignBody = z.infer<typeof signBody>;
