import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createRtiBody = z.object({
  applicationNo: z.string().min(1).max(64),
  applicantName: z.string().min(1).max(256),
  applicantAddr: z.string().max(1024).optional(),
  subject:       z.string().min(1).max(512),
  requestText:   z.string().min(1).max(8000),
  pioRef:        z.string().max(128).optional(),
  lifeOrLiberty: z.boolean().default(false),
  thirdParty:    z.boolean().default(false),
  feePaid:       z.number().int().nonnegative().default(0), // paise
  receivedAt:    z.string().datetime().optional(),
});
export type CreateRtiBody = z.infer<typeof createRtiBody>;

export const transferRtiBody = z.object({
  toAuthority: z.string().min(1).max(256),
  reason:      z.string().max(1024).optional(),
});
export type TransferRtiBody = z.infer<typeof transferRtiBody>;

export const thirdPartyConsultBody = z.object({
  thirdParty: z.string().min(1).max(256),
});
export type ThirdPartyConsultBody = z.infer<typeof thirdPartyConsultBody>;

export const additionalFeeBody = z.object({
  additionalFee: z.number().int().positive(), // paise
});
export type AdditionalFeeBody = z.infer<typeof additionalFeeBody>;

/** §8(1)(a)..(j) and §9. */
export const exemptionSection = z.enum([
  "8(1)(a)", "8(1)(b)", "8(1)(c)", "8(1)(d)", "8(1)(e)",
  "8(1)(f)", "8(1)(g)", "8(1)(h)", "8(1)(i)", "8(1)(j)", "9",
]);

export const respondRtiBody = z.object({
  decision:      z.enum(["provided", "partial", "rejected"]),
  responseText:  z.string().min(1).max(8000),
  exemptions:    z.array(z.object({
    section:       exemptionSection,
    justification: z.string().min(1).max(2000),
  })).max(20).optional(),
});
export type RespondRtiBody = z.infer<typeof respondRtiBody>;

export const fileAppealBody = z.object({
  tier:               z.enum(["first", "second"]),
  appellateAuthority: z.string().min(1).max(256),
  grounds:            z.string().min(1).max(4000),
});
export type FileAppealBody = z.infer<typeof fileAppealBody>;

/** Maker-checker: the appellate authority passes the order (checker step). */
export const appealOrderBody = z.object({
  orderStatus: z.enum(["allowed", "rejected", "partly_allowed"]),
  orderText:   z.string().min(1).max(8000),
});
export type AppealOrderBody = z.infer<typeof appealOrderBody>;

export const disclosureBody = z.object({
  category:    z.string().min(1).max(32),
  description: z.string().min(1).max(4000),
});
export type DisclosureBody = z.infer<typeof disclosureBody>;

export const appealIdParam = z.object({
  id:       z.string().uuid(),
  appealId: z.string().uuid(),
});
