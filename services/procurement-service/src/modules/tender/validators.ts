import { z } from "zod";

export const createTenderBody = z.object({
  title:          z.string().min(1).max(300),
  scope:          z.string().max(4000).optional(),
  eligibility:    z.string().max(4000).optional(),
  type:           z.enum(["open", "limited", "single_source", "gem"]).default("open"),
  estimatedMinor: z.number().int().nonnegative().default(0),
  emdAmountMinor: z.number().int().nonnegative().default(0),
  bidClosingDate: z.string().min(1),
  // GAP-PROCUREMENT-TENDERS-NEW-04: optional bid-opening date/time captured at
  // create (openingDate column already exists). Must be >= closing date (checked
  // in the command, where both are in hand).
  openingDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").refine(
      (v) => { const d = new Date(v + "T00:00:00.000Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; },
      "must be a real calendar date",
    ).optional(),
  // GAP-PROCUREMENT-TENDERS-NEW-01: opaque link to the authorising indent.
  indentRef:      z.string().min(1).max(200).optional(),
  // GAP-PROCUREMENT-TENDERS-NEW-02: GFR Rule 166 single-source justification.
  justificationCategory: z.enum(["proprietary", "emergency", "standardisation", "other"]).optional(),
  justification:  z.string().max(2000).optional(),
  approvingAuthority:    z.string().max(200).optional(),
  // C2: optional tender-level sanction reference. May also be supplied at award
  // time. A high-value tender (> Rs 1,000) MUST carry one before it can award.
  sanctionRef:    z.string().min(1).max(120).optional(),
}).refine(
  // GAP-PROCUREMENT-TENDERS-NEW-02: a single_source tender MUST record a
  // justification category, reason and approving authority (GFR Rule 166).
  (b) => b.type !== "single_source" || (
    !!b.justificationCategory && !!b.justification && b.justification.trim().length >= 10 && !!b.approvingAuthority
  ),
  { message: "single-source tenders require a justification category, a reason (min 10 chars) and an approving authority", path: ["justification"] },
);
export type CreateTenderBody = z.infer<typeof createTenderBody>;

// C2: award may carry/override the tender-level sanction reference so a tender
// created without one can still be sanctioned and awarded atomically.
export const awardTenderBody = z.object({
  sanctionRef: z.string().min(1).max(120).optional(),
});
export type AwardTenderBody = z.infer<typeof awardTenderBody>;

// Two sealed envelopes submitted together: technical fields + a SEPARATE
// financialAmountMinor that gets stored sealed.
export const submitBidBody = z.object({
  vendorId:             z.string().uuid(),
  vendorName:           z.string().max(300).default(""),
  technicalScore:       z.number().int().min(0).max(100).optional(),
  financialAmountMinor: z.number().int().nonnegative(),
});
export type SubmitBidBody = z.infer<typeof submitBidBody>;

export const techEvaluateBody = z.object({
  results: z.array(z.object({
    bidId:     z.string().uuid(),
    qualified: z.boolean(),
    score:     z.number().int().min(0).max(100).optional(),
    notes:     z.string().max(1000).optional(),
  })).min(1),
});
export type TechEvaluateBody = z.infer<typeof techEvaluateBody>;

export const idParam = z.object({ id: z.string().uuid() });
