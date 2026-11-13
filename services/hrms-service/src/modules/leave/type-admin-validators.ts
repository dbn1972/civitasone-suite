import { z } from "zod";

/** Built-in engine behaviours a tenant leave type may map to (must equal the codes in rules-engine LEAVE_POLICIES). */
export const SYSTEM_CODES = ["CL", "EL", "HPL", "COML", "ML", "PL", "CCL", "SL", "SCL", "CO"] as const;
export const LEAVE_TYPE_CATEGORIES = ["paid", "unpaid", "statutory", "comp_off"] as const;

const systemCode = z.enum(SYSTEM_CODES);
const category = z.enum(LEAVE_TYPE_CATEGORIES);
const gender = z.enum(["male", "female"]);

/** PATCH /v1/hrms/leave-types/:id -- the code is immutable; deactivation has its own maker-checker flow. */
export const updateLeaveTypeBody = z.object({
  name:               z.string().trim().min(1).max(128).optional(),
  maxDays:            z.number().int().nonnegative().optional(),
  isEncashable:       z.boolean().optional(),
  carryForward:       z.boolean().optional(),
  lopFractionBps:     z.number().int().min(0).max(10000).optional(),
  systemCode:         systemCode.nullable().optional(),
  category:           category.nullable().optional(),
  genderRestriction:  gender.nullable().optional(),
  description:        z.string().trim().max(1000).nullable().optional(),
  /** Optimistic lock: reject with 409 when the row moved on since the screen loaded it. */
  expectedVersion:    z.number().int().positive().optional(),
}).strict().refine((v) => Object.keys(v).some((k) => k !== "expectedVersion"), { message: "nothing to update" });
export type UpdateLeaveTypeBody = z.infer<typeof updateLeaveTypeBody>;

export const deactivateLeaveTypeBody = z.object({
  reason: z.string().trim().min(10, "give a reason of at least 10 characters").max(500),
  /** true = report the impact and blockers, write nothing. */
  dryRun: z.boolean().default(false),
}).strict();
export type DeactivateLeaveTypeBody = z.infer<typeof deactivateLeaveTypeBody>;

export const decideLeaveTypeChangeBody = z.object({
  note: z.string().trim().max(500).optional(),
}).strict();

export const rejectLeaveTypeChangeBody = z.object({
  note: z.string().trim().min(3, "a rejection needs a note").max(500),
}).strict();

/** End / reinstate one allocation: a maker-checker request; dryRun reports the days at stake and writes nothing. */
export const allocationChangeBody = z.object({
  reason: z.string().trim().min(10, "give a reason of at least 10 characters").max(500),
  dryRun: z.boolean().default(false),
}).strict();

export const retireUnusedBody = z.object({
  /** Default true: list candidates only. */
  dryRun: z.boolean().default(true),
  reason: z.string().trim().min(10).max(500).optional(),
}).strict();

export const customRulesBody = z.object({ enabled: z.boolean() }).strict();

export const leaveTypeAdminQuery = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
}).passthrough();

export const changeListQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
}).passthrough();
