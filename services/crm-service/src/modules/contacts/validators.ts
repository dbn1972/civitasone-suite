/** zod validators — applied at the route boundary. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createContactBody = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320).optional(),
  phone: z.string().min(3).max(32).optional(),
  company: z.string().min(1).max(200).optional(),
  designation: z.string().max(120).optional(),
  city: z.string().max(100).optional(),
  country: z.string().length(2).optional(),
  leadStatus: z.enum(["new", "contacted", "qualified", "unqualified", "customer"]).default("new"),
  leadSource: z.string().max(64).optional(),
  ownerId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  tags: z.array(z.string()).max(20).optional(),
  marketingConsent: z.boolean().optional(),
});
export type CreateContactBody = z.infer<typeof createContactBody>;

export const updateContactBody = createContactBody.partial().extend({
  status: z.enum(["active", "inactive"]).optional(),
});
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
  segment: z.enum(["all", "mine", "recent"]).default("all"),
});

export const createAccountBody = z.object({
  name: z.string().min(1).max(200),
  industry: z.string().max(64).optional(),
  website: z.string().max(320).optional(),
});
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
