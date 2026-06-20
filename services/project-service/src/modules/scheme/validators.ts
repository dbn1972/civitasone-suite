import { z } from "zod";

export const createSchemeBody = z.object({
  code:              z.string().min(1).max(64),
  name:              z.string().min(1).max(255),
  type:              z.enum(["css", "state", "central"]).default("css"),
  fundingPattern:    z.string().min(1).max(32).default("100"),
  totalOutlayMinor:  z.number().int().nonnegative().default(0),
  sanctionRef:       z.string().optional(),
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
