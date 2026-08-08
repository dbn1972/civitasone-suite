import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });

export const uploadBody = z.object({
  applicationId: z.string().uuid().optional(),
  citizenId:     z.string().uuid().optional(),
  serviceId:     z.string().uuid().optional(),
  docType:       safeText({ max: 64 }),
});
export type UploadBody = z.infer<typeof uploadBody>;

export const digilockerFetchBody = z.object({
  applicationId: z.string().uuid().optional(),
  citizenId:     z.string().uuid().optional(),
  serviceId:     z.string().uuid().optional(),
  docType:       safeText({ max: 64 }),
  docUri:        safeText({ max: 512 }),
});
export type DigilockerFetchBody = z.infer<typeof digilockerFetchBody>;

export const verifyBody = z.object({
  decision: z.enum(["verify", "reject", "deficient"]),
  reason:   safeText({ max: 2000, multiline: true }).optional(),
});
export type VerifyBody = z.infer<typeof verifyBody>;

export const resubmitBody = z.object({
  source: z.enum(["upload", "digilocker"]).default("upload"),
  docUri: safeText({ max: 512 }).optional(),
});
export type ResubmitBody = z.infer<typeof resubmitBody>;

export const checklistQuery = z.object({
  serviceId:     z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  /** FN-26 — when set, return only documents verified at this workflow lane. */
  laneKey:       safeText({ max: 64 }).optional(),
}).refine((q) => Boolean(q.serviceId || q.applicationId), {
  message: "serviceId or applicationId required",
});
export const applicationQuery = z.object({ applicationId: z.string().uuid() });
