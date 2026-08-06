import { z } from "zod";

/**
 * Money on the wire is a STRING of minor units — never a JSON number, which
 * would silently lose precision above 2^53. Parsed to bigint here so nothing
 * downstream ever sees a Number for money.
 */
const minorUnits = z
  .string()
  .regex(/^\d{1,25}$/, "must be a non-negative integer string of minor units")
  .transform((s) => BigInt(s));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const code = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/, "must be alphanumeric with . _ -");

export const currency = z.string().length(3).regex(/^[A-Z]{3}$/, "must be an ISO 4217 code").default("INR");

// ── Milestones ─────────────────────────────────────────────────────────────

export const createMilestoneBody = z.object({
  contractId:    z.string().uuid(),
  milestoneCode: code,
  name:          z.string().min(1).max(500),
  description:   z.string().max(5000).default(""),
  dueDate:       isoDate,
  ordinal:       z.coerce.number().int().min(1).max(9999).default(1),
  /** Null / omitted for a non-payment (deliverable-only) milestone. */
  amountMinor:   minorUnits.nullish(),
  currency,
});
export type CreateMilestoneBody = z.infer<typeof createMilestoneBody>;

export const transitionMilestoneBody = z
  .object({
    toStatus:     z.enum(["met", "missed", "waived"]),
    version:      z.coerce.number().int().min(1),
    completedAt:  z.string().datetime().optional(),
    waiverReason: z.string().min(1).max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.toStatus === "waived" && (v.waiverReason === undefined || v.waiverReason.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["waiverReason"],
        message: "waiverReason is required when waiving a milestone",
      });
    }
  });
export type TransitionMilestoneBody = z.infer<typeof transitionMilestoneBody>;

export const milestoneListQuery = z.object({
  contractId: z.string().uuid().optional(),
  status:     z.enum(["pending", "met", "missed", "waived"]).optional(),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
  offset:     z.coerce.number().int().min(0).default(0),
});

// ── Penalty terms ──────────────────────────────────────────────────────────

export const createPenaltyTermBody = z
  .object({
    contractId:         z.string().uuid(),
    termCode:           code,
    description:        z.string().max(5000).default(""),
    triggerType:        z.enum(["milestone_missed", "sla_breached"]),
    thresholdValue:     z.coerce.number().int().min(0).max(3650).default(0),
    penaltyKind:        z.enum(["fixed", "percentage", "per_day"]),
    penaltyAmountMinor: minorUnits.nullish(),
    /** Integer basis points. 1 bp = 0.01%, 10000 bp = 100%. */
    penaltyRateBps:     z.coerce.number().int().min(0).max(10_000).nullish(),
    maxPenaltyBps:      z.coerce.number().int().min(0).max(10_000).default(10_000),
    currency,
  })
  .superRefine((v, ctx) => {
    if (v.penaltyKind === "percentage") {
      if (v.penaltyRateBps === undefined || v.penaltyRateBps === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["penaltyRateBps"],
          message: "penaltyRateBps is required for a percentage penalty",
        });
      }
      if (v.penaltyAmountMinor !== undefined && v.penaltyAmountMinor !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["penaltyAmountMinor"],
          message: "a percentage penalty must not set penaltyAmountMinor",
        });
      }
      return;
    }
    if (v.penaltyAmountMinor === undefined || v.penaltyAmountMinor === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["penaltyAmountMinor"],
        message: `penaltyAmountMinor is required for a ${v.penaltyKind} penalty`,
      });
    }
    if (v.penaltyRateBps !== undefined && v.penaltyRateBps !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["penaltyRateBps"],
        message: `a ${v.penaltyKind} penalty must not set penaltyRateBps`,
      });
    }
  });
export type CreatePenaltyTermBody = z.infer<typeof createPenaltyTermBody>;

export const applyPenaltyBody = z.object({
  penaltyTermId:        z.string().uuid(),
  milestoneId:          z.string().uuid().optional(),
  /** Milestone id, or an SLA period code for a sla_breached term. */
  occurrenceRef:        z.string().min(1).max(200),
  overdueDays:          z.coerce.number().int().min(0).max(36_500).default(0),
  milestoneAmountMinor: minorUnits,
});
export type ApplyPenaltyBody = z.infer<typeof applyPenaltyBody>;

export const penaltyTermListQuery = z.object({
  contractId:  z.string().uuid().optional(),
  triggerType: z.enum(["milestone_missed", "sla_breached"]).optional(),
  limit:       z.coerce.number().int().min(1).max(200).default(50),
  offset:      z.coerce.number().int().min(0).default(0),
});

// ── Review schedules ───────────────────────────────────────────────────────

export const createReviewScheduleBody = z.object({
  contractId:     z.string().uuid(),
  reviewCode:     code,
  cadence:        z.enum(["monthly", "quarterly", "half_yearly", "annual"]),
  nextReviewDate: isoDate,
  reviewerRole:   z.string().min(1).max(64).default("contract_admin"),
  notes:          z.string().max(2000).optional(),
});
export type CreateReviewScheduleBody = z.infer<typeof createReviewScheduleBody>;

export const completeReviewBody = z.object({
  version: z.coerce.number().int().min(1),
  notes:   z.string().max(2000).optional(),
});
export type CompleteReviewBody = z.infer<typeof completeReviewBody>;

export const reviewListQuery = z.object({
  contractId: z.string().uuid().optional(),
  status:     z.enum(["scheduled", "completed", "cancelled"]).optional(),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
  offset:     z.coerce.number().int().min(0).default(0),
});

export const idParam = z.object({ id: z.string().uuid() });
