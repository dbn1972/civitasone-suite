import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const tenantQuery = z.object({ tenantId: z.string().uuid() });

export const createProfileBody = z.object({
  name:            z.string().min(1),
  email:           z.string().email().optional(),
  mobile:          z.string().min(10).max(16).optional(),
  digilockerToken: z.string().optional(),
  address:         z.string().optional(),
  ward:            z.string().optional(),
  /** DPDP §7: explicit consent required before collecting personal data */
  consentGranted:  z.literal(true, {
    errorMap: () => ({ message: "DPDP §7: consentGranted must be true to collect personal data" }),
  }),
});
export type CreateProfileBody = z.infer<typeof createProfileBody>;

/** DPDP §12: right to erasure — citizen requests account deletion */
export const deleteProfileBody = z.object({
  citizenId: z.string().uuid(),
  reason:    z.string().min(1).optional(),
});
export type DeleteProfileBody = z.infer<typeof deleteProfileBody>;
