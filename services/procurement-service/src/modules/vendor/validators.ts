import { z } from "zod";
import { isGstinChecksumValid, isValidGstinStateCode, gstinToPan } from "./gstin.js";

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
  // The bank account number's one canonical name is `bankAccount` (matches the
  // DB column bank_account and the read responses). The web form sends the same.
  bankAccount: z.string().max(32).optional(),
  category:    z.enum(["goods", "services", "works"]).optional(),
  contactPerson: z.string().max(128).optional(),
  address:     z.string().max(512).optional(),
  ifsc:        z.string().regex(IFSC_REGEX, "IFSC must be in format AAAA0XXXXXX").optional(),
});

/**
 * createVendorBody + cross-field identifier integrity (kept separate so
 * `createVendorBody.shape` stays a plain ZodObject for callers/tests).
 * GAP-PROCUREMENT-VENDORS-NEW-02: state code, mod-36 check digit and
 * GSTIN<->PAN agreement, enforced server-side.
 */
export const createVendorBodyChecked = createVendorBody.superRefine((v, ctx) => {
  if (v.gstin) {
    if (!isValidGstinStateCode(v.gstin)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gstin"], message: "GSTIN state code is not valid (expected 01-38, 97 or 99)" });
    } else if (!isGstinChecksumValid(v.gstin)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gstin"], message: "GSTIN check digit is invalid" });
    } else if (v.pan && gstinToPan(v.gstin) !== v.pan.toUpperCase()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pan"], message: "PAN does not match the PAN embedded in the GSTIN" });
    }
  }
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

/** GAP-PROCUREMENT-VENDORS-DETAIL-02: suspension needs a recorded reason. */
export const suspendBody = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type SuspendBody = z.infer<typeof suspendBody>;

export const idParam = z.object({ id: z.string().uuid() });
