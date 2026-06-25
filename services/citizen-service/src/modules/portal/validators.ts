import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });

export const tenantQuery = z.object({ tenantId: z.string().uuid() });

export const createProfileBody = z.object({
  /** P0-3/P0-4: officer-tier may create a profile for a given citizenId; a bare
   * citizen's id is forced to their own actorId at the route. */
  citizenId:       z.string().uuid().optional(),
  // P1-7: sanitised + capped before app-layer encryption (values are decrypted
  // on read and would be cleartext in any export, so the CSV guard matters).
  name:            safeText({ max: 160 }),
  email:           z.string().email().max(254).optional(),
  mobile:          z.string().min(10).max(16).regex(/^[+0-9 ()-]+$/, "invalid mobile").optional(),
  digilockerToken: safeText({ max: 512 }).optional(),
  address:         safeText({ max: 500, multiline: true }).optional(),
  ward:            safeText({ max: 80 }).optional(),
  /** DPDP §7: explicit consent required before collecting personal data */
  consentGranted:  z.literal(true, {
    errorMap: () => ({ message: "DPDP §7: consentGranted must be true to collect personal data" }),
  }),
});
export type CreateProfileBody = z.infer<typeof createProfileBody>;

/** DPDP §12: right to erasure — citizen requests account deletion */
export const deleteProfileBody = z.object({
  /** Optional/ignored: the profile to erase is taken from the :id path param and
   * constrained to the caller (P0-4). Kept for backward-compat. */
  citizenId: z.string().uuid().optional(),
  reason:    safeText({ max: 1000, multiline: true }).optional(),
});
export type DeleteProfileBody = z.infer<typeof deleteProfileBody>;
