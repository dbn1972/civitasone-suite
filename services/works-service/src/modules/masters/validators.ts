import { z } from "zod";
import { zMoneyMinorString } from "@civitasone/schemas";

/*
 * UAT B9-works (silent field drops): every master body schema below is
 * .strict(). zod's default object mode silently STRIPS unknown keys, and
 * drizzle silently ignores keys that are not columns of the target table, so
 * a field the table cannot store (e.g. `code` on proposer_types) used to be
 * 202-accepted and lost. A strict schema rejects it with a 400 instead, and
 * tests/masters-registry.test.ts asserts every schema key is a real column.
 */

/**
 * Create body for the name-only lookup masters (proposer-types, programs,
 * publication-levels, issue-types). Their tables have NO code column
 * (docs/DATABASE-SCHEMA.md), so `code` is not accepted (UAT B9-works: it was
 * 202-accepted and dropped).
 */
export const createMasterSchema = z.object({
  name: z.string().min(1).max(256),
  active: z.boolean().optional(),
}).strict();

export const updateMasterSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  code: z.string().min(1).max(64).optional(),
  active: z.boolean().optional(),
  version: z.number().int().min(1),
});

/**
 * PATCH body builder: the given editable fields (all optional, at least one
 * required) plus a REQUIRED `version` for optimistic concurrency. Strict, so
 * a field that is not editable for that master type is a 400, never a 202
 * that silently changes nothing (UAT B9-works).
 */
function patchSchemaOf<T extends z.ZodRawShape>(fields: T) {
  const keys = Object.keys(fields);
  return z
    .object({ ...fields, version: z.number().int().min(1) })
    .strict()
    .refine(
      (b) => keys.some((k) => (b as Record<string, unknown>)[k] !== undefined),
      { message: `at least one of ${keys.join(", ")} must be provided` },
    );
}

const editName = z.string().min(1).max(256).optional();
const editCode = z.string().min(1).max(64).optional();
const editActive = z.boolean().optional();

/**
 * GAP-WORKS-MASTERS-04: body schema for PATCH /v1/works/masters/:type/:id on
 * a master whose table has name AND code (authorities, work-types,
 * work-sub-types, assets, divisions). Conservatively limited to name, code and
 * the active flag. Parent links (workTypeId/programId/issueTypeId) and money
 * fields (rate/cost) are deliberately NOT editable here: changing a master's
 * parent or rate after live records reference it would silently rewrite
 * history (create a new master instead).
 */
export const patchMasterSchema = patchSchemaOf({ name: editName, code: editCode, active: editActive });

/** UAT B9-works: PATCH for masters with a name but no code column. */
export const patchNameMasterSchema = patchSchemaOf({ name: editName, active: editActive });

/** UAT B9-works: user departments - name, demand number (budget demand no.) and active are editable. */
export const patchUserDepartmentSchema = patchSchemaOf({
  name: editName,
  demandNumber: z.string().min(1).max(64).optional(),
  active: editActive,
});

/** UAT B9-works: contractor classes - name, description and active are editable. */
export const patchContractorClassSchema = patchSchemaOf({
  name: editName,
  description: z.string().min(1).max(512).optional(),
  active: editActive,
});

/**
 * UAT B9-works: sr_items has no name/code column and its rate/description are
 * referenced by BoQ lines, so only the active flag is editable (a PATCH with
 * `name` used to be 202-accepted and change nothing).
 */
export const patchSrItemSchema = patchSchemaOf({ active: editActive });

/** UAT B9-works: works.user_departments carries an optional demand_number (budget demand). */
export const createUserDepartmentSchema = z.object({
  name: z.string().min(1).max(256),
  demandNumber: z.string().min(1).max(64).optional(),
  active: z.boolean().optional(),
}).strict();

/** UAT B9-works: works.contractor_classes carries an optional description. */
export const createContractorClassSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(512).optional(),
  active: z.boolean().optional(),
}).strict();

export const createAuthoritySchema = z.object({
  name: z.string().min(1).max(256),
  code: z.string().min(1).max(64),
  level: z.string().max(64).optional(),
  active: z.boolean().optional(),
}).strict();

export const createWorkTypeSchema = z.object({
  name: z.string().min(1).max(256),
  code: z.string().min(1).max(64),
  active: z.boolean().optional(),
}).strict();

export const createWorkSubTypeSchema = z.object({
  name: z.string().min(1).max(256),
  code: z.string().min(1).max(64),
  workTypeId: z.string().uuid(),
  active: z.boolean().optional(),
}).strict();

export const createSrItemSchema = z.object({
  zone: z.string().min(1).max(64),
  srYear: z.string().min(1).max(16),
  itemCode: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  unit: z.string().min(1).max(64),
  rate: zMoneyMinorString,
  active: z.boolean().optional(),
}).strict();

export const createAssetSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  type: z.string().max(64).optional(),
  district: z.string().max(128).optional(),
  taluka: z.string().max(128).optional(),
  chainage: z.string().max(64).optional(),
  cost: zMoneyMinorString.optional(),
  active: z.boolean().optional(),
}).strict();

export const createScopeSchema = z.object({
  name: z.string().min(1).max(256),
  workTypeId: z.string().uuid(),
  unit: z.string().min(1).max(64),
  active: z.boolean().optional(),
}).strict();

export const createSchemeSchema = z.object({
  name: z.string().min(1).max(256),
  sponsor: z.string().max(256).optional(),
  active: z.boolean().optional(),
}).strict();

export const createTenderTypeSchema = z.object({
  name: z.string().min(1).max(256),
  rateType: z.string().max(64).optional(),
  active: z.boolean().optional(),
}).strict();

export const createRepairTypeSchema = z.object({
  name: z.string().min(1).max(256),
  programId: z.string().uuid(),
  active: z.boolean().optional(),
}).strict();

/**
 * UAT F75: works.issue_description_types requires issue_type_id (NOT NULL).
 * It used to be wired to the generic createMasterSchema, which stripped
 * issueTypeId, so every create was 202-accepted and then failed the consumer
 * insert (0 rows on UAT).
 */
export const createIssueDescriptionTypeSchema = z.object({
  name: z.string().min(1).max(256),
  issueTypeId: z.string().uuid(),
  active: z.boolean().optional(),
}).strict();

/**
 * UAT F76: works.work_description_types has NOT NULL work_type_id + keyword
 * and NO name column. It used to be wired to createMasterSchema ({name}),
 * which stripped both required fields, so no row could ever be created.
 */
export const createWorkDescriptionTypeSchema = z.object({
  keyword: z.string().min(1).max(256),
  workTypeId: z.string().uuid(),
  active: z.boolean().optional(),
}).strict();

/**
 * UAT F76: PATCH body for work-description-types. The generic
 * patchMasterSchema edits name/code, neither of which exists on this table,
 * so such an edit was 202-accepted and silently changed nothing. The editable
 * field here is the keyword; the parent work type stays immutable (same rule
 * as patchMasterSchema).
 */
export const patchWorkDescriptionTypeSchema = patchSchemaOf({
  keyword: z.string().min(1).max(256).optional(),
  active: editActive,
});

/** GAP-WORKS-REPORTS-01: body for the works division master (name/code + optional office type). */
export const createDivisionSchema = z.object({
  name: z.string().min(1).max(256),
  code: z.string().min(1).max(64),
  officeType: z.string().max(64).optional(),
  active: z.boolean().optional(),
}).strict();

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

/** UAT W6-A: every master table keys on a uuid id; a malformed id is the caller's 400, not a Postgres cast 500. */
export const idParamSchema = z.object({ id: z.string().uuid() });
