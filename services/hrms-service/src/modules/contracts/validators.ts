import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const uuidStr = z.string().uuid();

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
});

export const listContractsQuery = z.object({
  employeeId: uuidStr.optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
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
