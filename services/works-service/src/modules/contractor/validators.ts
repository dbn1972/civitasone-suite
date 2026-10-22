import { z } from "zod";

// GAP-WORKS-CONTRACTORS-NEW-01: enforce Indian tax-identifier FORMAT at the
// server boundary (CLAUDE.md rule 9: zod at every boundary), not just length,
// so a malformed PAN/GSTIN cannot enter the contractor master and later flow
// into TDS/GST on bills. Mirrors apps/web/src/lib/validation/indianIds.ts.
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const MOBILE_RE = /^[6-9][0-9]{9}$/;

const panField = z.union([z.literal(""), z.string().regex(PAN_RE, "invalid PAN")]);
const gstField = z.union([z.literal(""), z.string().regex(GSTIN_RE, "invalid GSTIN")]);
const phoneField = z.union([z.literal(""), z.string().regex(MOBILE_RE, "invalid mobile number")]);
const emailField = z.union([z.literal(""), z.string().email().max(256)]);

export const createContractorSchema = z.object({
  name:           z.string().min(1).max(256),
  registrationNo: z.string().max(64).optional(),
  classId:        z.string().uuid().optional(),
  pan:            panField.optional(),
  gst:            gstField.optional(),
  email:          emailField.optional(),
  phone:          phoneField.optional(),
  address:        z.string().max(1024).optional(),
});

export const rateContractorSchema = z.object({
  rating:  z.number().int().min(1).max(5),
  // GAP-WORKS-CONTRACTORS-DETAIL-04: optional basis/reason for the rating,
  // recorded in the rating history. Kept optional for backward compatibility
  // with older clients that send only { rating }.
  comment: z.string().trim().min(1).max(1000).optional(),
  // GAP-WORKS-CONTRACTORS-DETAIL-04: optional link to the work the rating is about.
  workId:  z.string().uuid().optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });
export const listQuerySchema = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * GAP-WORKS-CONTRACTORS-03 / -06: the register list accepts BOTH conventions in use in this service family: the
 * limit/offset pair (default 50) and the page/pageSize pair the web register and the contractor picker send
 * (?pageSize=100 / ?pageSize=200). page/pageSize win over offset/limit when given; a page is 1-based. `page` on its
 * own pages by the default limit ((page - 1) * limit); `pageSize` on its own is page 1. The resolved window is what
 * the route queries and echoes back in meta, together with the true total.
 */
export const contractorListQuerySchema = z
  .object({
    limit:    z.coerce.number().int().positive().max(200).default(50),
    offset:   z.coerce.number().int().nonnegative().default(0),
    page:     z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
  })
  .transform((q) => {
    const limit = q.pageSize ?? q.limit;
    const offset = q.pageSize !== undefined || q.page !== undefined ? ((q.page ?? 1) - 1) * limit : q.offset;
    return { limit, offset, page: Math.floor(offset / limit) + 1, pageSize: limit };
  });

export type CreateContractorBody  = z.infer<typeof createContractorSchema>;
export type RateContractorBody    = z.infer<typeof rateContractorSchema>;

export const updateContractorSchema = z.object({
  name:           z.string().min(1).max(256).optional(),
  registrationNo: z.string().max(64).optional(),
  pan:            panField.optional(),
  gst:            gstField.optional(),
  email:          emailField.optional(),
  phone:          phoneField.optional(),
  address:        z.string().max(1024).optional(),
}).refine((b) => Object.keys(b).length > 0, "at least one field required");

export type UpdateContractorBody = z.infer<typeof updateContractorSchema>;

// GAP-WORKS-CONTRACTORS-DETAIL-02: audited PAN reveal (DPDP). A reason is
// required and recorded in the audit event; the clear value is never logged.
export const revealPanSchema = z.object({
  reason: z.string().trim().min(5).max(300),
});
export type RevealPanBody = z.infer<typeof revealPanSchema>;
