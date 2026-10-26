import { z } from "zod";

/**
 * Owner decision #13: who the opinion is addressed to. Default = an internal department picked from the
 * org hierarchy; "external" carries a free-text party name. Required, so a request is never routed to nobody.
 */
export const addresseeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("department"), departmentId: z.string().uuid() }),
  z.object({ type: z.literal("external"), name: z.string().trim().min(1).max(256) }),
]);
export type Addressee = z.infer<typeof addresseeSchema>;

export const seekOpinionBody = z.object({
  // GAP-LEGAL-OPINIONS-NEW-02: opinionNo is OPTIONAL. When omitted the server
  // allocates the next number in the OPN/<year>/NNNN series atomically (see
  // the opinionSeek consumer); clients must NOT generate it themselves.
  opinionNo: z.string().min(1).max(64).optional(),
  subject:   z.string().min(1).max(256),
  question:  z.string().min(1).max(4000),
  caseId:    z.string().uuid().optional(),
  soughtBy:  z.string().max(256).optional(),
  addressee: addresseeSchema,
});
export type SeekOpinionBody = z.infer<typeof seekOpinionBody>;

export const draftOpinionBody = z.object({
  counselName: z.string().min(1).max(256),
  opinionText: z.string().min(1).max(20000),
});
export type DraftOpinionBody = z.infer<typeof draftOpinionBody>;

export const issueOpinionBody = z.object({
  opinionText: z.string().min(1).max(20000).optional(),
});
export type IssueOpinionBody = z.infer<typeof issueOpinionBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const listOpinionsQuery = z.object({
  status: z.enum(["sought", "drafted", "issued"]).optional(),
  caseId: z.string().uuid().optional(),
});
