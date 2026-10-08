import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });

// GAP-CITIZEN-DOCUMENTS-01: presign a direct-to-storage upload. The web first
// calls this to mint a short-lived SigV4 PUT URL (size/type validated here),
// uploads the file to object storage, then confirms with the returned key.
export const presignBody = z.object({
  filename:    safeText({ max: 255 }),
  contentType: safeText({ max: 128 }),
  sizeBytes:   z.number().int().positive().max(50 * 1024 * 1024),
});
export type PresignBody = z.infer<typeof presignBody>;

export const uploadBody = z.object({
  applicationId: z.string().uuid().optional(),
  citizenId:     z.string().uuid().optional(),
  serviceId:     z.string().uuid().optional(),
  docType:       safeText({ max: 64 }),
  // GAP-CITIZEN-DOCUMENTS-01: the opaque object key returned by /presign after
  // the browser PUTs the file to storage. REQUIRED so a bare JSON declaration
  // (no actual file) can no longer be recorded as an uploaded document.
  storageKey:    safeText({ max: 512 }),
});
export type UploadBody = z.infer<typeof uploadBody>;

export const digilockerFetchBody = z.object({
  applicationId: z.string().uuid().optional(),
  citizenId:     z.string().uuid().optional(),
  serviceId:     z.string().uuid().optional(),
  docType:       safeText({ max: 64 }),
  docUri:        safeText({ max: 512 }),
  // GAP-CITIZEN-DOCUMENTS-02: operator-captured DPDP consent attestation that
  // the applicant authorised fetching this document from DigiLocker. Optional
  // at the schema boundary for backward compatibility; the web requires it
  // before enabling the fetch control. Persisting it is a HUMAN REVIEW follow-up.
  consent:       z.boolean().optional(),
});
export type DigilockerFetchBody = z.infer<typeof digilockerFetchBody>;

// GAP-CITIZEN-DOCUMENTS-02 — begin the DigiLocker OAuth consent redirect. The
// server mints PKCE + state (bound to tenant+actor+citizen) and returns the
// provider authorize URL for the browser to redirect to.
export const authorizeBody = z.object({
  docType:       safeText({ max: 64 }),
  purpose:       safeText({ max: 120 }),
  citizenId:     z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  serviceId:     z.string().uuid().optional(),
  // Where the provider should redirect back to (web callback). Validated as an
  // absolute https URL so an open-redirect can't be smuggled in.
  redirectUri:   z.string().url().max(512),
});
export type AuthorizeBody = z.infer<typeof authorizeBody>;

// GAP-CITIZEN-DOCUMENTS-02 — the OAuth callback: exchange the code for the
// citizen-authorised docUri, persist a consent record, verify the artefact.
export const callbackBody = z.object({
  state: safeText({ max: 512 }),
  code:  safeText({ max: 2048 }),
  // Consent validity window in days (bounded); defaults to 90 for the record.
  consentTtlDays: z.coerce.number().int().positive().max(365).default(90),
});
export type CallbackBody = z.infer<typeof callbackBody>;

export const verifyBody = z.object({
  decision: z.enum(["verify", "reject", "deficient"]),
  reason:   safeText({ max: 2000, multiline: true }).optional(),
});
export type VerifyBody = z.infer<typeof verifyBody>;

export const resubmitBody = z.object({
  source: z.enum(["upload", "digilocker"]).default("upload"),
  docUri: safeText({ max: 512 }).optional(),
  // GAP-CITIZEN-DOCUMENTS-01: for an upload-source resubmission, the key of the
  // object the citizen re-uploaded via /presign. Required when source=upload.
  storageKey: safeText({ max: 512 }).optional(),
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
