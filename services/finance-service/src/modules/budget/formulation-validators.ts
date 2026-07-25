import { z } from "zod";

const FY = z.string().regex(/^\d{4}-\d{2}$/, "FY must be YYYY-YY");

export const createProposalBody = z.object({
  fy:            FY,
  deptCode:      z.string().min(1).max(64),
  headId:        z.string().uuid(),
  ceilingMinor:  z.number().int().nonnegative().default(0),
  proposedMinor: z.number().int().positive(),
  justification: z.string().max(2000).default(""),
  currency:      z.string().length(3).default("INR"),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreateProposalBody = z.infer<typeof createProposalBody>;

export const reviewProposalBody = z.object({
  decision: z.enum(["accept", "return"]),
  note:     z.string().min(3).max(1000),
});
export type ReviewProposalBody = z.infer<typeof reviewProposalBody>;

export const reviseProposalBody = z.object({
  proposedMinor: z.number().int().positive(),
  justification: z.string().max(2000).default(""),
  ceilingMinor:  z.number().int().nonnegative().optional(),
});
export type ReviseProposalBody = z.infer<typeof reviseProposalBody>;

export const proposalQuery = z.object({
  fy:       FY.optional(),
  deptCode: z.string().max(64).optional(),
  status:   z.string().max(24).optional(),
  limit:    z.coerce.number().int().min(1).max(500).default(100),
});

export const consolidationQuery = z.object({ fy: FY });

export const idParam = z.object({ id: z.string().uuid() });
