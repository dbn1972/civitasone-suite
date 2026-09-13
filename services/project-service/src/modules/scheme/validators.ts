import { z } from "zod";

export const createSchemeBody = z.object({
  code:              z.string().min(1).max(64),
  name:              z.string().min(1).max(255),
  type:              z.enum(["css", "state", "central"]).default("css"),
  fundingPattern:    z.string().min(1).max(32).default("100"),
  totalOutlayMinor:  z.number().int().nonnegative().default(0),
  sanctionRef:       z.string().optional(),
  // COMP-016 follow-up (migration 0021): pure-display fields with no
  // scheme-domain meaning (see the matching comment on scheme/schema.ts's
  // projectSchemes.nodalOfficer). Optional with no default, like
  // sanctionRef above — the backing columns are nullable with no DEFAULT,
  // so an unset field should persist as NULL ("not recorded"), never a
  // fabricated 0/empty-string value.
  nodalOfficer:      z.string().max(255).optional(),
  department:        z.string().max(255).optional(),
  beneficiaries:     z.number().int().nonnegative().optional(),
  startDate:         z.string().optional(),
  endDate:           z.string().optional(),
});
export type CreateSchemeBody = z.infer<typeof createSchemeBody>;

export const createComponentBody = z.object({
  code:             z.string().min(1).max(64),
  name:             z.string().min(1).max(255),
  allocationMinor:  z.number().int().nonnegative(),
  weightPct:        z.number().min(0).max(100).default(0),
});
export type CreateComponentBody = z.infer<typeof createComponentBody>;

export const createFundReleaseBody = z.object({
  releaseNo:     z.string().min(1).max(64),
  componentId:   z.string().uuid(),
  amountMinor:   z.number().int().positive(),
  toEntity:      z.enum(["state", "agency"]).default("agency"),
  pfmsRef:       z.string().optional(),
});
export type CreateFundReleaseBody = z.infer<typeof createFundReleaseBody>;

export const disburseBody = z.object({
  pfmsRef: z.string().optional(),
});
export type DisburseBody = z.infer<typeof disburseBody>;

export const schemeIdParam  = z.object({ id: z.string().uuid() });
export const releaseIdParam = z.object({ id: z.string().uuid(), rId: z.string().uuid() });
