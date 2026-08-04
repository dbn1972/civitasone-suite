/**
 * zod validators for LM-002 — public lead capture and its form registry.
 *
 * Two audiences with very different trust levels live in this file:
 *  - `publicLeadBody` parses data from an ANONYMOUS caller. It is `.strict()`, every
 *    string is length-capped, and it carries no field that could redirect the write
 *    (no tenantId, no formKey, no leadStatus, no ownerId).
 *  - the capture-form schemas parse data from an authenticated admin. They are also
 *    `.strict()`, and they deliberately have NO `formKey` field: the key is generated
 *    server-side, because a client-chosen key would be guessable and would let anyone
 *    post leads into another tenant's form.
 */
import { z } from "zod";

/** Length cap on every UTM value. They are opaque ad-platform identifiers, not prose. */
export const MAX_UTM_LENGTH = 128;

/**
 * Hard body bound, enforced by Fastify BEFORE the payload is buffered in full, so an
 * oversized submission on the unauthenticated path costs us nothing. 16 KiB is an
 * order of magnitude more than the largest legitimate lead form.
 */
export const MAX_PUBLIC_BODY_BYTES = 16 * 1024;

/**
 * The form key as it appears in the URL: exactly 64 lowercase hex chars, matching what
 * `generateFormKey()` produces and the varchar(64) column. Shape is checked by the
 * route rather than by zod on the params, so a malformed key yields the SAME 404 as an
 * unknown one — a 400 here would tell a scanner it had at least got the format right.
 */
export const FORM_KEY_PATTERN = /^[0-9a-f]{64}$/;

const utmValue = z.string().max(MAX_UTM_LENGTH);

/**
 * Public submission body.
 *
 * `.strict()` is load-bearing, not tidiness: it is what makes `{"tenantId": "..."}`
 * a 400 rather than a silently ignored (or worse, honoured) override.
 */
export const publicLeadBody = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(320).optional(),
    phone: z.string().min(4).max(32).optional(),
    company: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    designation: z.string().max(120).optional(),
    /**
     * Explicit marketing consent (DPDP Act 2023). Optional in the SCHEMA only so the
     * route can answer 422 CONSENT_REQUIRED instead of a generic 400 — it is never
     * defaulted to true. `consentDate` is intentionally absent: the server stamps it,
     * because a client-supplied consent date is not evidence of anything.
     */
    consent: z.boolean().optional(),
    /** Free-text channel label. Falls back to the form's default, then 'public_form'. */
    source: z.string().max(64).optional(),
    utm: z
      .object({
        source: utmValue.optional(),
        medium: utmValue.optional(),
        campaign: utmValue.optional(),
        term: utmValue.optional(),
        content: utmValue.optional(),
      })
      .strict()
      .optional(),
    campaignId: z.string().uuid().optional(),
    /**
     * Honeypot. A field no human sees and no real form fills in; bots fill every input
     * they find. Accepted as an optional string so filling it is not a validation
     * error — the route answers the normal 202 and drops the submission, because
     * telling a bot it was detected just teaches it to skip the field next time.
     */
    _hp: z.string().max(200).optional(),
  })
  .strict();

export type PublicLeadBody = z.infer<typeof publicLeadBody>;
export type PublicLeadUtm = NonNullable<PublicLeadBody["utm"]>;

/**
 * Origin allowlist entries. Full scheme+host origins, as a browser sends them —
 * a bare hostname would silently never match `req.headers.origin`.
 */
const originEntry = z
  .string()
  .max(255)
  .regex(/^https?:\/\/[^/\s]+$/, "must be a scheme+host origin, e.g. https://example.gov.in");

export const createCaptureFormBody = z
  .object({
    name: z.string().min(1).max(200),
    enabled: z.boolean().optional(),
    requireConsent: z.boolean().optional(),
    allowedOrigins: z.array(originEntry).max(50).optional(),
    defaultLeadSource: z.string().min(1).max(64).optional(),
    campaignId: z.string().uuid().optional(),
    // Bounds mirror the DB CHECK. Rejected here so a bad value is a 400 rather than a
    // 202 followed by a constraint violation the caller never sees.
    maxPerMinute: z.number().int().min(1).max(600).optional(),
  })
  .strict();
export type CreateCaptureFormBody = z.infer<typeof createCaptureFormBody>;

/** Every field optional, but at least one required — an empty PATCH is a no-op, not a 202. */
export const updateCaptureFormBody = createCaptureFormBody
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field must be supplied" });
export type UpdateCaptureFormBody = z.infer<typeof updateCaptureFormBody>;

export const captureFormIdParam = z.object({ id: z.string().uuid() });

export const captureFormViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  formKey: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  requireConsent: z.boolean(),
  allowedOrigins: z.array(z.string()),
  defaultLeadSource: z.string().nullable(),
  campaignId: z.string().uuid().nullable(),
  maxPerMinute: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const captureFormListSchema = z.object({
  data: z.array(captureFormViewSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
});

/**
 * The ONLY thing the public endpoint ever returns on success.
 *
 * No contact id, no tenant id, no echo of the submitted values. An anonymous caller
 * must not be able to confirm what was stored, enumerate ids, or use the endpoint as
 * an oracle for whether an email address is already a lead.
 */
export const publicAcceptedSchema = z.object({
  status: z.literal("accepted"),
  correlationId: z.string(),
});
