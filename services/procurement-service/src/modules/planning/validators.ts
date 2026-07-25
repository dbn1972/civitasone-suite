import { z } from "zod";
import { PROCUREMENT_CATEGORIES, PROCUREMENT_METHODS } from "./domain.js";

const lineSchema = z.object({
  itemCode:            z.string().min(1).max(64),
  description:         z.string().min(1).max(500),
  aggregatedQty:       z.number().int().nonnegative().default(0),
  uom:                 z.string().min(1).max(32).default("nos"),
  procurementCategory: z.enum(PROCUREMENT_CATEGORIES).default("goods"),
  procurementMethod:   z.enum(PROCUREMENT_METHODS).default("gem"),
  budgetLine:          z.string().max(128).optional(),
  estimatedValueMinor: z.number().int().nonnegative().default(0),
  timelineQuarter:     z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
  packageGroup:        z.string().max(64).optional(),
  sourceIndentIds:     z.array(z.string().uuid()).default([]),
});

export const createPlanBody = z.object({
  planYear:   z.number().int().min(2000).max(2100),
  title:      z.string().min(3).max(256),
  department: z.string().min(1).max(128),
  notes:      z.string().max(1000).optional(),
  lines:      z.array(lineSchema).default([]),
});
export type CreatePlanBody = z.infer<typeof createPlanBody>;

/** Aggregate demand from approved indents into plan lines (yearly demand). */
export const aggregateFromIndentsBody = z.object({
  planYear:      z.number().int().min(2000).max(2100),
  title:         z.string().min(3).max(256),
  department:    z.string().min(1).max(128),
  indentIds:     z.array(z.string().uuid()).min(1).max(500),
  defaultMethod: z.enum(PROCUREMENT_METHODS).default("gem"),
  notes:         z.string().max(1000).optional(),
});
export type AggregateFromIndentsBody = z.infer<typeof aggregateFromIndentsBody>;

export const submitPlanBody = z.object({
  notes: z.string().max(500).optional(),
});
export type SubmitPlanBody = z.infer<typeof submitPlanBody>;

export const approvePlanBody = z.object({
  notes: z.string().max(500).optional(),
});
export type ApprovePlanBody = z.infer<typeof approvePlanBody>;

export const rejectPlanBody = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectPlanBody = z.infer<typeof rejectPlanBody>;

export const linkTenderBody = z.object({
  lineId:   z.string().uuid(),
  tenderId: z.string().uuid(),
});
export type LinkTenderBody = z.infer<typeof linkTenderBody>;

export const idParam = z.object({ id: z.string().uuid() });
