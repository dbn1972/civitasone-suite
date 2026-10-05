/** LQ-004 zod validators — lifecycle reason code catalog admin. */
import { z } from "zod";

export const REASON_CODE_TARGET_STATUSES = ["nurture", "recycled", "disqualified", "new", "qualified"] as const;

export const reasonCodeSchema = z.object({
  code: z.string().min(1).max(48).regex(/^[a-z0-9_]+$/, "code must be lowercase snake_case"),
  label: z.string().min(1).max(160),
  appliesToStatus: z.enum(REASON_CODE_TARGET_STATUSES),
  active: z.boolean().default(true),
});

export const putReasonCodesBody = z.object({
  codes: z.array(reasonCodeSchema).min(1).max(50),
  // GAP-CRM-LEAD-REASON-CODES-04: optional list-level optimistic-concurrency
  // token. Also accepted via the If-Match header; the header takes precedence.
  version: z.string().min(1).optional(),
});
export type PutReasonCodesBody = z.infer<typeof putReasonCodesBody>;
