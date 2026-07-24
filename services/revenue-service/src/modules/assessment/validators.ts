/**
 * Assessment module — request body zod schemas.
 *
 * _Requirements: SVC-131, Requirement 6_
 */
import { z } from "zod";
import { bigintString } from "../../shared/validators.js";

const financialYearPattern = /^\d{4}-\d{2}$/;

export const createAssessmentBody = z.object({
  assesseeId: z.string().uuid(),
  rateHeadId: z.string().uuid(),
  financialYear: z.string().regex(financialYearPattern, "must match YYYY-YY pattern"),
  baseValue: bigintString,
  exemptions: z
    .array(
      z.object({
        type: z.string().min(1),
        amount: bigintString,
      }),
    )
    .optional(),
});

export const reviseAssessmentBody = z.object({
  version: z.number().int().min(1),
  reason: z.string().min(1).max(500),
  newBaseValue: bigintString,
  newExemptions: z
    .array(
      z.object({
        type: z.string().min(1),
        amount: bigintString,
      }),
    )
    .optional(),
});

export const remitBody = z.object({
  reason: z.string().min(1).max(500),
  remissionPercent: z.number().int().min(1).max(100),
});

export const remitDecideBody = z.object({
  approve: z.boolean(),
  reason: z.string().min(1).max(500).optional(),
});
