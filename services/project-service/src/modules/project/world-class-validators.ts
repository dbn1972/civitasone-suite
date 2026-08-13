import { z } from "zod";

// Money is paise (minor units) — accept integers from JSON as number, but the
// route layer converts to BigInt before any arithmetic / persistence.
const paise = z.number().int().nonnegative();
const paisePos = z.number().int().positive();

const RISK_LEVEL = z.enum(["low", "medium", "high", "critical"]);

// ─── Params ────────────────────────────────────────────────────────────────
export const projectIdParam = z.object({ id: z.string().uuid() });
export const billParam = z.object({ id: z.string().uuid(), billId: z.string().uuid() });
export const extParam  = z.object({ id: z.string().uuid(), extId: z.string().uuid() });
export const riskParam = z.object({ id: z.string().uuid(), riskId: z.string().uuid() });

// ─── Risks ─────────────────────────────────────────────────────────────────
export const createRiskBody = z.object({
  title:          z.string().min(1).max(256),
  description:    z.string().max(4000).optional(),
  category:       z.enum(["technical", "financial", "environmental", "social", "regulatory", "resource", "schedule"]).default("technical"),
  probability:    RISK_LEVEL.default("medium"),
  impact:         RISK_LEVEL.default("medium"),
  mitigationPlan: z.string().max(4000).optional(),
  ownerId:        z.string().uuid().optional(),
  status:         z.enum(["open", "mitigated", "occurred", "closed"]).default("open"),
});

export const updateRiskBody = z.object({
  title:          z.string().min(1).max(256).optional(),
  description:    z.string().max(4000).optional(),
  category:       z.enum(["technical", "financial", "environmental", "social", "regulatory", "resource", "schedule"]).optional(),
  probability:    RISK_LEVEL.optional(),
  impact:         RISK_LEVEL.optional(),
  mitigationPlan: z.string().max(4000).optional(),
  ownerId:        z.string().uuid().optional(),
  status:         z.enum(["open", "mitigated", "occurred", "closed"]).optional(),
}).strict();

// ─── EVM ───────────────────────────────────────────────────────────────────
export const computeEvmBody = z.object({
  period:                   z.string().min(1).max(7),
  plannedValueMinor:        paise.default(0),
  earnedValueMinor:         paise.default(0),
  actualCostMinor:          paise.default(0),
  budgetAtCompletionMinor:  paise.optional(),
});

// ─── RA Bills ──────────────────────────────────────────────────────────────
export const createRaBillBody = z.object({
  contractorId:    z.string().uuid(),
  contractorName:  z.string().max(256).optional(),
  billNo:          z.string().min(1).max(64),
  billDate:        z.string().min(1).max(32),
  workDescription: z.string().max(4000).optional(),
  grossAmountMinor: paisePos,
  deductionsMinor:  paise.default(0),
  netAmountMinor:   paise,
  cumulativeMinor:  paise.default(0),
});

// ─── Time Extensions ───────────────────────────────────────────────────────
export const createTimeExtBody = z.object({
  originalEndDate:    z.string().min(1).max(32),
  extendedEndDate:    z.string().min(1).max(32),
  extensionDays:      z.number().int().positive(),
  reason:             z.string().min(1).max(4000),
  penaltyApplicable:  z.boolean().default(false),
  penaltyPerDayMinor: paise.default(0),
});

// ─── Penalties ─────────────────────────────────────────────────────────────
export const createPenaltyBody = z.object({
  contractorId:    z.string().uuid().optional(),
  penaltyType:     z.enum(["delay", "quality", "safety", "other"]).default("delay"),
  fromDate:        z.string().min(1).max(32),
  toDate:          z.string().min(1).max(32),
  days:            z.number().int().positive(),
  ratePerDayMinor: paise,
  recoveredFrom:   z.string().max(64).optional(),
});

// ─── Resources ─────────────────────────────────────────────────────────────
export const createResourceBody = z.object({
  taskId:         z.string().uuid().optional(),
  resourceType:   z.enum(["person", "equipment", "material", "vehicle"]).default("person"),
  resourceId:     z.string().uuid().optional(),
  resourceName:   z.string().min(1).max(256),
  allocatedHours: z.number().nonnegative().optional(),
  dailyRateMinor: paise.default(0),
  fromDate:       z.string().max(32).optional(),
  toDate:         z.string().max(32).optional(),
});

// ─── Baselines ─────────────────────────────────────────────────────────────
export const createBaselineBody = z.object({
  baselineNo:        z.number().int().positive().default(1),
  snapshotDate:      z.string().min(1).max(32),
  plannedStart:      z.string().min(1).max(32),
  plannedEnd:        z.string().min(1).max(32),
  plannedCostMinor:  paise,
  milestonesSnapshot: z.array(z.unknown()).default([]),
});
