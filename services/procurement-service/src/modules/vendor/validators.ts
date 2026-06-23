import { z } from "zod";

// PAN format: 5 uppercase letters + 4 digits + 1 uppercase letter (AAAAA9999A)
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
// GSTIN format: 2-digit state code + 10-char PAN + 1 entity code + 1 checksum char + Z
// Full pattern: 15 alphanumeric, e.g. 27AABCS1429B1Z5
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
// IFSC: 4 uppercase letters + 0 + 6 alphanumeric
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const createVendorBody = z.object({
  name:        z.string().min(1).max(256),
  gstin:       z.string().regex(GSTIN_REGEX, "GSTIN must be 15-character alphanumeric in format: 2-digit state + PAN + entity + Z + checksum").optional(),
  pan:         z.string().regex(PAN_REGEX, "PAN must be in format AAAAA9999A (5 letters, 4 digits, 1 letter)").optional(),
  email:       z.string().email().optional(),
  phone:       z.string().max(20).optional(),
  mse:         z.boolean().default(false),
  msme:        z.boolean().default(false),
  udyamNo:     z.string().max(32).optional(),
  bankAccount: z.string().max(32).optional(),
  ifsc:        z.string().regex(IFSC_REGEX, "IFSC must be in format AAAA0XXXXXX").optional(),
});
export type CreateVendorBody = z.infer<typeof createVendorBody>;

export const empanelBody = z.object({
  category:   z.string().min(1).max(128),
  validUntil: z.string().optional(),
});
export type EmpanelBody = z.infer<typeof empanelBody>;

export const blacklistBody = z.object({
  reason: z.string().min(5).max(500),
});
export type BlacklistBody = z.infer<typeof blacklistBody>;

export const idParam = z.object({ id: z.string().uuid() });
