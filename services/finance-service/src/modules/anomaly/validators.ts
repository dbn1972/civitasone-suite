/**
 * Zod validation schemas for anomaly detection routes.
 *
 * Requirements: 11.6, 11.7
 */
import { z } from "zod";

export const anomalyListQuery = z.object({
  status: z.enum(["open", "reviewed", "dismissed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const dismissBody = z.object({
  reason: z.string().min(1).max(1000),
});

export const anomalyIdParam = z.object({
  id: z.string().uuid(),
});

export type AnomalyListQuery = z.infer<typeof anomalyListQuery>;
export type DismissBody = z.infer<typeof dismissBody>;
