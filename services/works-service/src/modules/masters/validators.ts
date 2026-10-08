import { z } from "zod";
import { zMoneyMinorString } from "@civitasone/schemas";

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

/**
 * GAP-WORKS-MASTERS-04: body schema for PATCH /v1/works/masters/:type/:id.
 * Conservatively limited to the fields that are safe to edit after creation
 * across every master type — name, code and the active flag — plus a REQUIRED
 * `version` for optimistic concurrency (reject a stale write). Parent links
 * (workTypeId/programId/issueTypeId) and money fields (rate/cost) are
 * deliberately NOT editable here: changing a master's parent or rate after
 * live records reference it would silently rewrite history, so those are
 * out of scope for an in-place edit (create a new master instead). At least
 * one editable field must be present alongside version.
 */
export const patchMasterSchema = z
  .object({
    name: z.string().min(1).max(256).optional(),
    code: z.string().min(1).max(64).optional(),
    active: z.boolean().optional(),
    version: z.number().int().min(1),
  })
  .refine(
    (b) => b.name !== undefined || b.code !== undefined || b.active !== undefined,
    { message: "at least one of name, code or active must be provided" },
  );

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
  rate: zMoneyMinorString,
  active: z.boolean().optional(),
});

export const createAssetSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  type: z.string().max(64).optional(),
  district: z.string().max(128).optional(),
  taluka: z.string().max(128).optional(),
  chainage: z.string().max(64).optional(),
  cost: zMoneyMinorString.optional(),
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

/** GAP-WORKS-REPORTS-01: body for the works division master (name/code + optional office type). */
export const createDivisionSchema = z.object({
  name: z.string().min(1).max(256),
  code: z.string().min(1).max(64),
  officeType: z.string().max(64).optional(),
  active: z.boolean().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

/** GAP-WORKS-BOQ-NEW-01: query for the SR-items typeahead (BoQ Add-item picker). */
export const srItemSearchSchema = z.object({
  q: z.string().max(256).optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

/** GAP-WORKS-REPORTS-01: query for the divisions typeahead (reports division picker). */
export const divisionSearchSchema = z.object({
  q: z.string().max(256).optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});
