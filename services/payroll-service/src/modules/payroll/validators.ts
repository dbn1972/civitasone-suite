import { z } from "zod";

export const createStructureBody = z.object({
  name:        z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  isDefault:   z.boolean().default(false),
});
export type CreateStructureBody = z.infer<typeof createStructureBody>;

export const createRunBody = z.object({
  runNo:        z.string().min(1).max(64),
  month:        z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM"),
  departmentId: z.string().uuid().optional(),
  // Multi-DDO: scope a run to one DDO; employees are grouped by department->DDO.
  ddoCode:      z.string().min(1).max(32).optional(),
  // structureId is irrelevant for pensioner runs (pension uses the pensioner master).
  structureId:  z.string().uuid().optional(),
  runType:      z.enum(["regular", "supplementary", "arrears", "pensioner"]).optional(),
}).refine((b) => b.runType === "pensioner" || b.structureId != null, {
  message: "structureId is required for non-pensioner runs",
  path: ["structureId"],
});
export type CreateRunBody = z.infer<typeof createRunBody>;

export const idParam = z.object({ id: z.string().uuid() });

// Multi-DDO admin
export const createDdoBody = z.object({
  ddoCode: z.string().min(1).max(32),
  name:    z.string().min(1).max(200),
  departmentIds: z.array(z.string().uuid()).default([]),
});
export type CreateDdoBody = z.infer<typeof createDdoBody>;

// Pensioner master admin. Money is paise (bigint, sent as integer string/number).
const paise = z.union([z.string(), z.number()]).transform((v) => BigInt(v));
export const createPensionerBody = z.object({
  ppoNo:                 z.string().min(1).max(64),
  fullName:              z.string().min(1).max(200),
  dateOfBirth:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  basicPensionMinor:     paise,
  commutedPensionMinor:  paise.optional(),
  commutationDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  medicalAllowanceMinor: paise.optional(),
  ddoCode:               z.string().min(1).max(32).optional(),
  bankAccountNo:         z.string().max(64).optional(),
  bankIfsc:              z.string().max(16).optional(),
  pan:                   z.string().max(16).optional(),
  taxRegime:             z.enum(["old", "new"]).default("new"),
});
export type CreatePensionerBody = z.infer<typeof createPensionerBody>;

export const slipQueryParams = z.object({
  runId: z.string().uuid().optional(),
});
