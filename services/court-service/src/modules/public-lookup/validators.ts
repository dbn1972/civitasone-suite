import { z } from "zod";

/**
 * Publish (or re-publish) a public-directory establishment (AUTHENTICATED, admin).
 * `cnrPrefix` is optional — derived from the first 6 chars of `establishmentCode`
 * (uppercased) when absent.
 */
export const publishEstablishmentBody = z.object({
  establishmentCode: z.string().trim().min(1).max(32),
  cnrPrefix:         z.string().trim().min(1).max(8).optional(),
  courtName:         z.string().trim().min(1).max(200),
  publicSlug:        z.string().trim().regex(/^[a-z0-9-]{2,64}$/, "publicSlug must be 2–64 chars of a-z, 0-9, hyphen"),
  // Optional: set the court's public-lookup access method in the same call
  // (otp = OTP-gated, captcha = eCourts/HC/SC style, open = no gate).
  accessMode:        z.enum(["otp", "captcha", "open"]).optional(),
});
export type PublishEstablishmentBody = z.infer<typeof publishEstablishmentBody>;

/** Request an OTP for a public case-status lookup. `mobile` is PII, never stored raw. */
export const requestOtpBody = z.object({
  mobile: z.string().trim().min(1).max(20),
});
export type RequestOtpBody = z.infer<typeof requestOtpBody>;

/**
 * Verify the OTP and look up a case. At least one of `cnr` / (`slug` + `cnr`) must be
 * present — enforced in the route (zod can't easily express the cross-field rule with
 * the friendliest error here).
 */
export const lookupBody = z.object({
  cnr:          z.string().trim().max(32).optional(),
  slug:         z.string().trim().max(64).optional(),
  // OTP-mode credentials (required only when the court's access_mode is 'otp').
  challengeId:  z.string().uuid().optional(),
  otp:          z.string().regex(/^\d{6}$/, "otp must be 6 digits").optional(),
  // Captcha-mode credential (required only when access_mode is 'captcha').
  captchaToken: z.string().min(1).max(4000).optional(),
});
export type LookupBody = z.infer<typeof lookupBody>;
