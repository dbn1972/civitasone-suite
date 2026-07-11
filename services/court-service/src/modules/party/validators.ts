import { z } from "zod";

export const caseIdParam = z.object({ id: z.string().uuid() });
export const partyIdParam = z.object({ id: z.string().uuid() });

/** Party roles for §14 (parties) + §15 (advocates). */
export const PARTY_ROLE_VALUES = [
  "petitioner",
  "respondent",
  "applicant",
  "opposite_party",
  "intervenor",
  "advocate",
  "witness",
] as const;

/** Add a party (petitioner/respondent/…) or an advocate to a case (§14/§15).
 *  name/address/phone/email are PII — stored ENCRYPTED via the encryptedText columns. */
export const addPartyBody = z.object({
  partyRole:     z.enum(PARTY_ROLE_VALUES),
  // Ordinal that distinguishes multiple same-role parties on one case (e.g. a
  // second respondent). The party id is deterministic on (case, role, partyIndex)
  // so re-submitting the SAME ordinal is idempotent, but two distinct respondents
  // (index 0 and 1) get distinct rows instead of collapsing into one.
  partyIndex:    z.coerce.number().int().min(0).max(999).optional(),
  name:          z.string().trim().max(200).optional(),
  address:       z.string().trim().max(500).optional(),
  phone:         z.string().trim().max(20).optional(),
  email:         z.string().trim().max(200).email().optional(),
  advocateName:  z.string().trim().max(200).optional(),
  advocateBarId: z.string().trim().max(64).optional(),
});
export type AddPartyBody = z.infer<typeof addPartyBody>;

/** Update an advocate's details on an existing party row (§15). `expectedVersion`
 *  is the optimistic-lock token. */
export const updateAdvocateBody = z.object({
  advocateName:    z.string().trim().max(200).optional(),
  advocateBarId:   z.string().trim().max(64).optional(),
  expectedVersion: z.coerce.number().int().min(1),
});
export type UpdateAdvocateBody = z.infer<typeof updateAdvocateBody>;
