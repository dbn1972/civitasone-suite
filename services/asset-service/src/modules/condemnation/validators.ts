import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createSurveyBody = z.object({
  assetId:    z.string().uuid(),
  surveyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  condition:  z.enum(["good", "fair", "poor", "unserviceable", "beyond_repair"]),
  conditionNotes: z.string().max(2000).optional(),
  yearsInUse: z.number().int().nonnegative().optional(),
  estimatedRepairCostMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).default("INR"),
});
export type CreateSurveyBody = z.infer<typeof createSurveyBody>;

export const submitSurveyBody = z.object({
  version: z.number().int().positive(),
  recommendation: z.enum(["condemn", "repair", "continue_use"]),
});
export type SubmitSurveyBody = z.infer<typeof submitSurveyBody>;

export const createRecommendationBody = z.object({
  surveyId:         z.string().uuid(),
  assetId:          z.string().uuid(),
  committeeMembers: z.array(z.object({
    name: z.string().min(1),
    designation: z.string().min(1),
    employeeRef: z.string().uuid().optional(),
  })).min(2),
  decision:         z.enum(["condemn", "repair", "continue_use", "downgrade"]),
  reason:           z.string().min(1).max(2000),
  reserveValueMinor: z.number().int().nonnegative().optional(),
  floorValueMinor:   z.number().int().nonnegative().optional(),
  currency:         z.string().length(3).default("INR"),
});
export type CreateRecommendationBody = z.infer<typeof createRecommendationBody>;

export const approveRecommendationBody = z.object({
  version: z.number().int().positive(),
});
export type ApproveRecommendationBody = z.infer<typeof approveRecommendationBody>;

export const createAuctionBody = z.object({
  assetId:           z.string().uuid(),
  recommendationId:  z.string().uuid(),
  reserveValueMinor: z.number().int().positive(),
  currency:          z.string().length(3).default("INR"),
  auctionDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreateAuctionBody = z.infer<typeof createAuctionBody>;

export const completeAuctionBody = z.object({
  version:           z.number().int().positive(),
  highestBidMinor:   z.number().int().positive(),
  winnerName:        z.string().min(1).max(200),
  winnerRef:         z.string().max(128).optional(),
  saleProceedsMinor: z.number().int().positive(),
});
export type CompleteAuctionBody = z.infer<typeof completeAuctionBody>;
