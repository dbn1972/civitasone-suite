import { z } from "zod";

export const createMasterSchema = z.object({
  name: z.string().min(1).max(256),
  code: z.string().min(1).max(64).optional(),
  active: z.boolean().optional(),
});

export const updateMasterSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  code: z.string().min(1).max(64).optional(),
  active: z.boolean().optional(),
  version: z.number().int().min(1),
});

export const createAuthoritySchema = z.object({
  name: z.string().min(1).max(256),
  code: z.string().min(1).max(64),
  level: z.string().max(64).optional(),
  active: z.boolean().optional(),
});

export const createWorkTypeSchema = z.object({
  name: z.string().min(1).max(256),
  code: z.string().min(1).max(64),
  active: z.boolean().optional(),
});

export const createWorkSubTypeSchema = z.object({
  name: z.string().min(1).max(256),
  code: z.string().min(1).max(64),
  workTypeId: z.string().uuid(),
  active: z.boolean().optional(),
});

export const createSrItemSchema = z.object({
  zone: z.string().min(1).max(64),
  srYear: z.string().min(1).max(16),
  itemCode: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  unit: z.string().min(1).max(64),
  rate: z.string().or(z.number()),
  active: z.boolean().optional(),
});

export const createAssetSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  type: z.string().max(64).optional(),
  district: z.string().max(128).optional(),
  taluka: z.string().max(128).optional(),
  chainage: z.string().max(64).optional(),
  cost: z.string().or(z.number()).optional(),
  active: z.boolean().optional(),
});

export const createScopeSchema = z.object({
  name: z.string().min(1).max(256),
  workTypeId: z.string().uuid(),
  unit: z.string().min(1).max(64),
  active: z.boolean().optional(),
});

export const createSchemeSchema = z.object({
  name: z.string().min(1).max(256),
  sponsor: z.string().max(256).optional(),
  active: z.boolean().optional(),
});

export const createTenderTypeSchema = z.object({
  name: z.string().min(1).max(256),
  rateType: z.string().max(64).optional(),
  active: z.boolean().optional(),
});

export const createRepairTypeSchema = z.object({
  name: z.string().min(1).max(256),
  programId: z.string().uuid(),
  active: z.boolean().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
