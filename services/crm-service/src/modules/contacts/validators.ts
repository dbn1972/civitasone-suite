/** zod validators — applied at the route boundary. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";
import {
  collectFormatViolations,
  CONTACT_FORMAT_SPECS,
  ACCOUNT_FORMAT_SPECS,
  type FormatFieldSpec,
} from "./format-validators.js";

/**
 * DQ-003: attach Indian-format checks to a schema. Each violation surfaces as a
 * distinct error code (INVALID_MOBILE / INVALID_PINCODE / INVALID_GSTIN /
 * INVALID_PAN) at the offending field, so the route returns 400 with a
 * machine-readable reason. Absent/empty optional values are never flagged.
 */
function formatRefiner(specs: readonly FormatFieldSpec[]) {
  return (val: Record<string, unknown>, ctx: z.RefinementCtx): void => {
    for (const v of collectFormatViolations(val, specs)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.code, path: [v.field] });
    }
  };
}

const createContactObject = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320).optional(),
  phone: z.string().min(3).max(32).optional(),
  company: z.string().min(1).max(200).optional(),
  designation: z.string().max(120).optional(),
  city: z.string().max(100).optional(),
  country: z.string().length(2).optional(),
  // DQ-001/003 business identifiers + PIN.
  gstin: z.string().max(15).optional(),
  pan: z.string().max(10).optional(),
  pincode: z.string().max(6).optional(),
  leadStatus: z.enum(["new", "contacted", "qualified", "unqualified", "customer"]).default("new"),
  leadSource: z.string().max(64).optional(),
  ownerId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  tags: z.array(z.string()).max(20).optional(),
  marketingConsent: z.boolean().optional(),
});

export const createContactBody = createContactObject.superRefine(formatRefiner(CONTACT_FORMAT_SPECS));
export type CreateContactBody = z.infer<typeof createContactBody>;

export const updateContactBody = createContactObject
  .partial()
  .extend({ status: z.enum(["active", "inactive"]).optional() })
  .superRefine(formatRefiner(CONTACT_FORMAT_SPECS));
export type UpdateContactBody = z.infer<typeof updateContactBody>;

export const mergeContactsBody = z.object({
  primaryId: z.string().uuid(),
  duplicateId: z.string().uuid(),
});
export type MergeContactsBody = z.infer<typeof mergeContactsBody>;

export const bulkImportBody = z.object({
  contacts: z.array(createContactBody).min(1).max(500),
});
export type BulkImportBody = z.infer<typeof bulkImportBody>;

export const listContactsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().max(100).optional(),
  leadStatus: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  // "segment" is the pre-existing saved-view mode (all/mine/recent). The LQ-003
  // classification "segment" column is filtered via "segmentName" to avoid
  // overloading this param.
  segment: z.enum(["all", "mine", "recent"]).default("all"),
  // LQ-003 classification filters (report/filter using all classification fields).
  temperature: z.enum(["hot", "warm", "cold"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  segmentName: z.string().max(64).optional(),
  product: z.string().max(120).optional(),
  region: z.string().max(64).optional(),
  source: z.string().max(64).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  expectedValueMin: z.coerce.number().int().nonnegative().optional(),
  expectedValueMax: z.coerce.number().int().nonnegative().optional(),
});

// LQ-003: PATCH /v1/crm/contacts/:id/classification body. All fields optional so a
// caller can set just one; expected_value is a non-negative integer of paise.
export const classificationBody = z.object({
  temperature: z.enum(["hot", "warm", "cold"]).nullable().optional(),
  priority: z.enum(["high", "medium", "low"]).nullable().optional(),
  segment: z.string().max(64).nullable().optional(),
  product: z.string().max(120).nullable().optional(),
  region: z.string().max(64).nullable().optional(),
  expectedValueMinor: z.coerce.number().int().nonnegative().nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one classification field is required" });
export type ClassificationBody = z.infer<typeof classificationBody>;

const createAccountObject = z.object({
  name: z.string().min(1).max(200),
  industry: z.string().max(64).optional(),
  website: z.string().max(320).optional(),
  // DQ-001/003 business identifiers on the account.
  gstin: z.string().max(15).optional(),
  pan: z.string().max(10).optional(),
});
export const createAccountBody = createAccountObject.superRefine(formatRefiner(ACCOUNT_FORMAT_SPECS));
export type CreateAccountBody = z.infer<typeof createAccountBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const accountViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  industry: z.string().nullable(),
  website: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  contactCount: z.number().int().nonnegative(),
});

export const accountsListSchema = z.object({ data: z.array(accountViewSchema) });

export const contactViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  designation: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  gstin: z.string().nullable(),
  pan: z.string().nullable(),
  pincode: z.string().nullable(),
  temperature: z.string().nullable(),
  priority: z.string().nullable(),
  segment: z.string().nullable(),
  product: z.string().nullable(),
  region: z.string().nullable(),
  expectedValueMinor: z.string().nullable(),
  leadStatus: z.string(),
  leadSource: z.string().nullable(),
  ownerId: z.string().uuid().nullable(),
  accountId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  marketingConsent: z.boolean(),
  consentDate: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const contactsListSchema = paginatedSchema(contactViewSchema);
