/**
 * GAP-CRM-GRIEVANCES-NEW-03 — grievance-category master client.
 *
 * Wraps the crm-service admin CRUD at /v1/crm/grievance-categories through the
 * BFF proxy (browserFetch). The tenant table starts EMPTY, so the built-in
 * DEFAULT_GRIEVANCE_CATEGORIES list below is the single documented fallback: the
 * new-grievance form offers the tenant's configured categories when any exist,
 * and falls back to this labelled constant (with an inline notice) when the
 * tenant has configured none or the load fails. A failed load never fabricates
 * an empty list as fact — the editor renders an ErrorState instead.
 */
import { browserFetch, errorMessageFromResponse, UserFacingError } from "@/lib/api/browserClient";
import { referenceFromHeaders } from "@/lib/errorCatalogue";
import { z } from "zod";

export type MasterSource = "api" | "error";

export interface LoaderResult<T> {
  data: T;
  source: MasterSource;
}

export interface GrievanceCategory {
  id?: string;
  code: string;
  label: string;
  active: boolean;
  sortOrder: number;
  version?: number;
}

/**
 * The built-in default grievance categories, kept ONLY as the labelled
 * fallback. These mirror the nine CPGRAMS-aligned values that used to be
 * hard-coded in the new-grievance form. `code` is the lowercase snake_case key
 * the admin API expects; `label` is what the form shows (and what the grievance
 * row stores).
 */
export const DEFAULT_GRIEVANCE_CATEGORIES: readonly { code: string; label: string }[] = [
  { code: "water_supply", label: "Water Supply" },
  { code: "electricity", label: "Electricity" },
  { code: "roads_infrastructure", label: "Roads & Infrastructure" },
  { code: "sanitation", label: "Sanitation" },
  { code: "health_services", label: "Health Services" },
  { code: "education", label: "Education" },
  { code: "public_safety", label: "Public Safety" },
  { code: "revenue_land_records", label: "Revenue & Land Records" },
  { code: "other", label: "Other" },
] as const;

/* ---------------------------------------------------------------- helpers */
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function bool(v: unknown, dflt = false): boolean {
  return typeof v === "boolean" ? v : dflt;
}
function num(v: unknown, dflt = 0): number {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const k of ["data", "items", "categories"]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function normaliseGrievanceCategory(raw: unknown): GrievanceCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const code = str(r.code);
  const label = str(r.label) || str(r.name);
  if (!code && !label) return null;
  return {
    id: str(r.id) || undefined,
    code,
    label,
    active: bool(r.active, true),
    sortOrder: num(r.sortOrder ?? r.sort_order, 0),
    version: typeof r.version === "number" ? r.version : undefined,
  };
}

export function normaliseGrievanceCategories(raw: unknown): GrievanceCategory[] {
  return toArray(raw)
    .map(normaliseGrievanceCategory)
    .filter((t): t is GrievanceCategory => t !== null);
}

/** The tenant's configured categories (empty array is a valid "none configured yet"). */
export async function getGrievanceCategories(): Promise<LoaderResult<GrievanceCategory[]>> {
  try {
    const res = await browserFetch("v1/crm/grievance-categories");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseGrievanceCategories(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/**
 * The active option labels to offer in the citizen-facing select, with a
 * `fellBack` flag the form uses to show the inline "showing the standard list"
 * notice. When the tenant has configured active categories we use those;
 * otherwise (none configured, or load error) we fall back to the labelled
 * default list.
 */
export function grievanceCategoryOptions(
  result: LoaderResult<GrievanceCategory[]>,
): { labels: string[]; fellBack: boolean } {
  const active = result.source === "api" ? result.data.filter((c) => c.active) : [];
  if (active.length > 0) {
    return {
      labels: active.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)).map((c) => c.label),
      fellBack: false,
    };
  }
  return { labels: DEFAULT_GRIEVANCE_CATEGORIES.map((c) => c.label), fellBack: true };
}

/* --------------------------------------------------------------- validation */
export const grievanceCategorySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Enter a code.")
    .max(64, "Code is too long.")
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores only."),
  label: z.string().trim().min(1, "Enter a label.").max(160, "Label is too long."),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
});

export interface GrievanceCategoryErrors {
  code?: string;
  label?: string;
}

export function validateGrievanceCategory(c: GrievanceCategory): GrievanceCategoryErrors {
  const parsed = grievanceCategorySchema.safeParse(c);
  if (parsed.success) return {};
  const errors: GrievanceCategoryErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (key === "code" && !errors.code) errors.code = issue.message;
    else if (key === "label" && !errors.label) errors.label = issue.message;
  }
  return errors;
}

export function isGrievanceCategoryValid(c: GrievanceCategory): boolean {
  return grievanceCategorySchema.safeParse(c).success;
}

/* --------------------------------------------------------------------- CRUD */
export async function createGrievanceCategory(c: GrievanceCategory): Promise<void> {
  const res = await browserFetch("v1/crm/grievance-categories", {
    method: "POST",
    body: JSON.stringify({ code: c.code.trim(), label: c.label.trim(), active: c.active, sortOrder: c.sortOrder }),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
}

export async function updateGrievanceCategory(id: string, c: GrievanceCategory): Promise<void> {
  const res = await browserFetch(`v1/crm/grievance-categories/${id}`, {
    method: "PUT",
    body: JSON.stringify({ label: c.label.trim(), active: c.active, sortOrder: c.sortOrder }),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
}

export async function deleteGrievanceCategory(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/grievance-categories/${id}`, { method: "DELETE" });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
}
