import { z } from "zod";
import { CHANGE_TYPES, CHANGE_RISKS, PIR_OUTCOMES } from "./domain.js";

export const idParam = z.object({ id: z.string().uuid() });

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createChangeBody = z.object({
  title: z.string().min(3).max(200),
  type: z.enum(CHANGE_TYPES),
  risk: z.enum(CHANGE_RISKS).default("medium"),
  affectedServices: z.array(z.string().min(1).max(80)).max(50).default([]),
  description: z.string().min(10).max(5000),
  // Optional at draft time; enforced as mandatory before CAB approval.
  rollbackPlan: z.string().min(10).max(5000).optional(),
});

export const rollbackPlanBody = z.object({
  rollbackPlan: z.string().min(10).max(5000),
});

export const approveBody = z.object({
  note: z.string().max(2000).optional(),
});

export const rejectBody = z.object({
  reason: z.string().min(3).max(2000),
});

export const scheduleBody = z.object({
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});

export const completeBody = z.object({
  outcome: z.enum(PIR_OUTCOMES),
  notes: z.string().min(3).max(5000),
  // Release notes broadcast to users on a successful release.
  releaseNotes: z.string().min(3).max(5000).optional(),
});

export const createFreezeBody = z.object({
  name: z.string().min(3).max(200),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().min(3).max(2000),
});
