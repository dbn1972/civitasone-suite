/**
 * Custom Fields configuration client (crm-service custom-fields module, Req 8.8).
 *
 * All calls route through the BFF proxy via browserFetch (httpOnly session).
 * On a failed load the loaders return { source: "error" } so the screen can
 * render "—" + DataSourceBadge instead of fabricating an empty catalogue as
 * fact.
 *
 * BACKEND CONTRACT (services/crm-service/src/modules/custom-fields):
 *  - GET    /v1/crm/custom-fields/:entityType         → { data: [...], meta }
 *  - GET    /v1/crm/custom-fields/definition/:id       → { data: {...} }
 *  - POST   /v1/crm/custom-fields                       → 202 (consumer writes)
 *  - PATCH  /v1/crm/custom-fields/:id                   → 202
 *  - DELETE /v1/crm/custom-fields/:id                   → 202
 *
 * The backend field model is { entityType, fieldName, fieldType, ordinal,
 * validationSchema } where validationSchema is a free-form JSON blob. We store
 * the UI notions of "required" and select "options" INSIDE validationSchema —
 * there is no dedicated required/options/label/key column server-side.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export type CfEntityType = "leads" | "contacts" | "deals";
export type CfFieldType = "text" | "number" | "date" | "boolean" | "select" | "multi_select";
export type CfSource = "api" | "error";

export const ENTITY_TYPES: CfEntityType[] = ["leads", "contacts", "deals"];
export const FIELD_TYPES: CfFieldType[] = ["text", "number", "date", "boolean", "select", "multi_select"];

export const ENTITY_TYPE_LABELS: Record<CfEntityType, string> = {
  leads: "Leads",
  contacts: "Contacts",
  deals: "Deals",
};

export const FIELD_TYPE_LABELS: Record<CfFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes / No",
  select: "Single select",
  multi_select: "Multi select",
};

/** Field types that carry a fixed list of options the clerk picks from. */
export function fieldTypeHasOptions(t: CfFieldType): boolean {
  return t === "select" || t === "multi_select";
}

/** Free-form validation blob; we only interpret required + options. */
export interface CustomFieldValidation {
  required?: boolean;
  options?: string[];
  [k: string]: unknown;
}

export interface CustomField {
  id: string;
  entityType: CfEntityType;
  fieldName: string;
  fieldType: CfFieldType;
  validationSchema: CustomFieldValidation | null;
  ordinal: number;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** The editable draft a form/row works with. */
export interface CustomFieldDraft {
  id?: string;
  entityType: CfEntityType;
  fieldName: string;
  fieldType: CfFieldType;
  required: boolean;
  options: string[];
  ordinal: number;
}

export interface LoaderResult<T> {
  data: T;
  source: CfSource;
}

export interface DraftErrors {
  fieldName?: string;
  options?: string;
}

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function isEntityType(v: unknown): v is CfEntityType {
  return typeof v === "string" && (ENTITY_TYPES as string[]).includes(v);
}

function isFieldType(v: unknown): v is CfFieldType {
  return typeof v === "string" && (FIELD_TYPES as string[]).includes(v);
}

/** Read the option list out of a free-form validation blob, tolerant of shape. */
export function optionsFromValidation(v: CustomFieldValidation | null | undefined): string[] {
  if (!v || typeof v !== "object") return [];
  const raw = (v as CustomFieldValidation).options;
  if (!Array.isArray(raw)) return [];
  return raw.map(str).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function requiredFromValidation(v: CustomFieldValidation | null | undefined): boolean {
  return !!(v && typeof v === "object" && (v as CustomFieldValidation).required === true);
}

/** Normalise one raw record (camel or snake case) into a CustomField, or null. */
export function normaliseCustomField(raw: unknown): CustomField | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const entityType = r.entityType ?? r.entity_type;
  const fieldType = r.fieldType ?? r.field_type;
  if (!isEntityType(entityType) || !isFieldType(fieldType)) return null;
  const rawVs = (r.validationSchema ?? r.validation_schema) as unknown;
  const validationSchema =
    rawVs && typeof rawVs === "object" ? (rawVs as CustomFieldValidation) : null;
  const ordinalRaw = r.ordinal;
  return {
    id,
    entityType,
    fieldName: str(r.fieldName ?? r.field_name),
    fieldType,
    validationSchema,
    ordinal: typeof ordinalRaw === "number" ? ordinalRaw : Number(ordinalRaw) || 0,
    version: typeof r.version === "number" ? r.version : undefined,
    createdAt: r.createdAt != null ? str(r.createdAt) : r.created_at != null ? str(r.created_at) : undefined,
    updatedAt: r.updatedAt != null ? str(r.updatedAt) : r.updated_at != null ? str(r.updated_at) : undefined,
  };
}

/** Tolerate a bare array or a { data: [...] } / { fields: [...] } wrapper. */
export function normaliseCustomFields(raw: unknown): CustomField[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((raw as { data?: unknown }).data ??
          (raw as { fields?: unknown }).fields ??
          [])
      : [];
  const arr = Array.isArray(list) ? list : [];
  return arr
    .map(normaliseCustomField)
    .filter((f): f is CustomField => f !== null)
    .sort((a, b) => a.ordinal - b.ordinal);
}

/** Turn a stored CustomField into an editable draft. */
export function toDraft(f: CustomField): CustomFieldDraft {
  return {
    id: f.id,
    entityType: f.entityType,
    fieldName: f.fieldName,
    fieldType: f.fieldType,
    required: requiredFromValidation(f.validationSchema),
    options: optionsFromValidation(f.validationSchema),
    ordinal: f.ordinal,
  };
}

export function blankDraft(entityType: CfEntityType, ordinal = 0): CustomFieldDraft {
  return { entityType, fieldName: "", fieldType: "text", required: false, options: [], ordinal };
}

/** Build the validationSchema blob a mutation sends, or null when empty. */
export function buildValidationSchema(draft: CustomFieldDraft): CustomFieldValidation | null {
  const out: CustomFieldValidation = {};
  if (draft.required) out.required = true;
  if (fieldTypeHasOptions(draft.fieldType)) {
    const opts = draft.options.map((o) => o.trim()).filter((o) => o.length > 0);
    if (opts.length > 0) out.options = opts;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Validate a draft. fieldName is always required (it is the label/key). A
 * select / multi_select field must carry at least one non-empty option.
 */
export function validateDraft(draft: CustomFieldDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (draft.fieldName.trim().length === 0) {
    errors.fieldName = "Enter a field name.";
  } else if (draft.fieldName.trim().length > 64) {
    errors.fieldName = "Field name must be 64 characters or fewer.";
  }
  if (fieldTypeHasOptions(draft.fieldType)) {
    const opts = draft.options.map((o) => o.trim()).filter((o) => o.length > 0);
    if (opts.length === 0) errors.options = "Add at least one option for a select field.";
  }
  return errors;
}

export function isDraftValid(draft: CustomFieldDraft): boolean {
  return Object.keys(validateDraft(draft)).length === 0;
}

// ---------------------------------------------------------------------------
// loaders + mutations
// ---------------------------------------------------------------------------

export async function listCustomFields(entityType: CfEntityType): Promise<LoaderResult<CustomField[]>> {
  try {
    const res = await browserFetch(`v1/crm/custom-fields/${entityType}`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseCustomFields(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function getCustomField(id: string): Promise<LoaderResult<CustomField | null>> {
  try {
    const res = await browserFetch(`v1/crm/custom-fields/definition/${id}`);
    if (!res.ok) return { data: null, source: "error" };
    const body = (await res.json()) as unknown;
    const rec = body && typeof body === "object" ? ((body as { data?: unknown }).data ?? body) : body;
    return { data: normaliseCustomField(rec), source: "api" };
  } catch {
    return { data: null, source: "error" };
  }
}

export async function createCustomField(draft: CustomFieldDraft): Promise<void> {
  const body = {
    entityType: draft.entityType,
    fieldName: draft.fieldName.trim(),
    fieldType: draft.fieldType,
    ordinal: draft.ordinal,
    validationSchema: buildValidationSchema(draft),
  };
  const res = await browserFetch("v1/crm/custom-fields", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updateCustomField(id: string, draft: CustomFieldDraft): Promise<void> {
  const body = {
    fieldName: draft.fieldName.trim(),
    fieldType: draft.fieldType,
    ordinal: draft.ordinal,
    validationSchema: buildValidationSchema(draft),
  };
  const res = await browserFetch(`v1/crm/custom-fields/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteCustomField(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/custom-fields/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}
