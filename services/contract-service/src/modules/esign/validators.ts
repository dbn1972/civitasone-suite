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

// SEC: the signer's identity is ALWAYS the authenticated caller (ctx.actorId),
// never a client-supplied field. This body previously accepted a `userId` that
// was used as-is to decide who signed — any caller holding one of the module's
// (broad) roles could pass a different signatory's userId and have the system
// record that person as having signed, with no check that the caller actually
// was that person. There is nothing left for the client to legitimately assert
// here, so the body carries no fields; unknown keys (e.g. a stray `userId` from
// an old caller) are accepted and ignored rather than rejected.
export const signBody = z.object({});
export type SignBody = z.infer<typeof signBody>;
