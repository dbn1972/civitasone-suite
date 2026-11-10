import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const uuidStr = z.string().uuid();

// S8 G5: optional project reference carried inside contract terms (additive: older contracts have none).
const projectRef = {
  projectId: uuidStr.optional(),
  projectCode: z.string().min(1).max(32).optional(),
  projectName: z.string().min(1).max(160).optional(),
};

export const createContractBody = z.object({
  employeeId: uuidStr,
  startDate: dateStr,
  endDate: dateStr,
  terms: z.object({
    role: z.string().min(1).max(200),
    compensationMinor: z.string().regex(/^\d+$/, "must be non-negative integer string"),
    currency: z.string().length(3).default("INR"),
    workingHours: z.string().max(100).optional(),
    deliverables: z.array(z.string().max(500)).max(20).optional(),
    kpis: z.array(z.string().max(500)).max(20).optional(),
    specialConditions: z.string().max(2000).optional(),
    ...projectRef,
  }),
});

export const activateContractBody = z.object({ version: z.number().int().min(1) });

export const initiateRenewalBody = z.object({
  newEndDate: dateStr,
  newTerms: z.object({
    role: z.string().min(1).max(200).optional(),
    compensationMinor: z.string().regex(/^\d+$/).optional(),
    currency: z.string().length(3).optional(),
    workingHours: z.string().max(100).optional(),
    deliverables: z.array(z.string().max(500)).max(20).optional(),
    kpis: z.array(z.string().max(500)).max(20).optional(),
    specialConditions: z.string().max(2000).optional(),
    ...projectRef,
  }).optional(),
  reason: z.string().min(1).max(1000).optional(),
});

export const bulkRenewalBody = z.object({
  contractIds: z.array(uuidStr).min(1).max(50),
  newEndDate: dateStr,
  reason: z.string().max(1000).optional(),
});

export const terminateContractBody = z.object({
  version: z.number().int().min(1),
  reason: z.string().min(1).max(1000),
});

export const updateConfigBody = z.object({
  reminderMilestones: z.array(z.number().int().min(1).max(365)).min(1).max(10).optional(),
  approvalChain: z.array(z.object({ role: z.string().min(1).max(64) })).max(5).optional(),
  autoSeparationEnabled: z.boolean().optional(),
  schedulerTimeUtc: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  // S8 G5 -- tenant policy for an unrenewed lapse (default auto_separate = today) and alert routing.
  lapseAction: z.enum(["auto_separate", "flag_only"]).optional(),
  graceDays: z.number().int().min(0).max(365).optional(),
  notifyRoles: z.array(z.enum(["project_manager", "line_manager"])).max(2).optional(),
  employeeProjectionEnabled: z.boolean().optional(),
  weeklyDigestEnabled: z.boolean().optional(),
});

// S8 G5: opt-in expansion + project filter + CSV for the expiring dashboard.
export const expiringDashboardQuery = z.object({
  projectId: uuidStr.optional(),
  format: z.enum(["json", "csv"]).optional(),
  expand: z.enum(["project"]).optional(),
});

export const listContractsQuery = z.object({
  employeeId: uuidStr.optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // GAP-HR-CONTRACTUAL-03/04: both opt-in, so every existing caller keeps the
  // createdAt-desc order and the unchanged response shape.
  //   sort=endDate   soonest-ending first (ties by id, for stable paging)
  //   summary=true   adds meta.summary: FULL-SCOPE counts (active / expiring /
  //                  expired / agencies) for the register's stat cards, so they
  //                  are not computed from whichever page happened to load
  sort: z.enum(["endDate"]).optional(),
  summary: z.enum(["true"]).optional(),
});

export const listRenewalsQuery = z.object({
  contractId: uuidStr.optional(),
  employeeId: uuidStr.optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idParam = z.object({ id: uuidStr });
export const employeeIdParam = z.object({ employeeId: uuidStr });

export type CreateContractBody = z.infer<typeof createContractBody>;
export type InitiateRenewalBody = z.infer<typeof initiateRenewalBody>;
export type BulkRenewalBody = z.infer<typeof bulkRenewalBody>;
