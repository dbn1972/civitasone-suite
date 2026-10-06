/**
 * GAP-CRM-SERVICE-REQUESTS-NEW-02 — service-type master client.
 *
 * Wraps the crm-service admin CRUD at /v1/crm/service-types through the BFF
 * proxy (browserFetch). The tenant table starts EMPTY, so the built-in
 * DEFAULT_SERVICE_TYPES list below is the single documented fallback: the
 * new-request form offers the tenant's configured types when any exist, and
 * falls back to this labelled constant (with an inline notice) when the tenant
 * has configured none or the load fails. A failed load never fabricates an
 * empty list as fact — editors render an ErrorState instead.
 */
import { browserFetch, errorMessageFromResponse, UserFacingError } from "@/lib/api/browserClient";
import { referenceFromHeaders } from "@/lib/errorCatalogue";
import { z } from "zod";

export type MasterSource = "api" | "error";

export interface LoaderResult<T> {
  data: T;
  source: MasterSource;
}

export interface ServiceType {
  id?: string;
  code: string;
  label: string;
  active: boolean;
  sortOrder: number;
  /** F6-03: optional SLA target in hours; drives the SR new-form derived due date. */
  slaHours?: number | null;
  version?: number;
}

/**
 * The built-in default service types, kept ONLY as the labelled fallback. These
 * mirror the ten values that used to be hard-coded in the new-request form.
 * `code` is the lowercase snake_case key the admin API expects; `label` is what
 * the citizen-facing form shows (and what the service_requests row stores).
 */
export const DEFAULT_SERVICE_TYPES: readonly { code: string; label: string }[] = [
  { code: "new_water_connection", label: "New Water Connection" },
  { code: "new_electricity_connection", label: "New Electricity Connection" },
  { code: "birth_certificate", label: "Birth Certificate" },
  { code: "death_certificate", label: "Death Certificate" },
  { code: "property_mutation", label: "Property Mutation" },
  { code: "trade_licence", label: "Trade Licence" },
  { code: "building_permission", label: "Building Permission" },
  { code: "waste_collection", label: "Waste Collection" },
  { code: "street_light_installation", label: "Street Light Installation" },
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
    for (const k of ["data", "items", "serviceTypes", "types"]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function normaliseServiceType(raw: unknown): ServiceType | null {
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
    slaHours:
      r.slaHours === null || r.sla_hours === null
        ? null
        : typeof (r.slaHours ?? r.sla_hours) === "number"
          ? ((r.slaHours ?? r.sla_hours) as number)
          : undefined,
    version: typeof r.version === "number" ? r.version : undefined,
  };
}

export function normaliseServiceTypes(raw: unknown): ServiceType[] {
  return toArray(raw)
    .map(normaliseServiceType)
    .filter((t): t is ServiceType => t !== null);
}

/** The tenant's configured service types (empty array is a valid "none configured yet"). */
export async function getServiceTypes(): Promise<LoaderResult<ServiceType[]>> {
  try {
    const res = await browserFetch("v1/crm/service-types");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseServiceTypes(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/**
 * The active option labels to offer in the citizen-facing select, with a
 * `fellBack` flag the form uses to show the inline "showing the standard list"
 * notice. When the tenant has configured active types we use those; otherwise
 * (none configured, or load error) we fall back to the labelled default list.
 */
export function serviceTypeOptions(result: LoaderResult<ServiceType[]>): { labels: string[]; fellBack: boolean } {
  const active = result.source === "api" ? result.data.filter((t) => t.active) : [];
  if (active.length > 0) {
    return {
      labels: active.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)).map((t) => t.label),
      fellBack: false,
    };
  }
  return { labels: DEFAULT_SERVICE_TYPES.map((t) => t.label), fellBack: true };
}

/* --------------------------------------------------------------- validation */
export const serviceTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Enter a code.")
    .max(64, "Code is too long.")
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores only."),
  label: z.string().trim().min(1, "Enter a label.").max(160, "Label is too long."),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  // F6-03: optional SLA target. null/undefined = no SLA; otherwise 1..87600 hours.
  slaHours: z.number().int().min(1, "SLA must be at least 1 hour.").max(87600, "SLA is too long.").nullish(),
});

export interface ServiceTypeErrors {
  code?: string;
  label?: string;
}

export function validateServiceType(t: ServiceType): ServiceTypeErrors {
  const parsed = serviceTypeSchema.safeParse(t);
  if (parsed.success) return {};
  const errors: ServiceTypeErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (key === "code" && !errors.code) errors.code = issue.message;
    else if (key === "label" && !errors.label) errors.label = issue.message;
  }
  return errors;
}

export function isServiceTypeValid(t: ServiceType): boolean {
  return serviceTypeSchema.safeParse(t).success;
}

/* --------------------------------------------------------------------- CRUD */
export async function createServiceType(t: ServiceType): Promise<void> {
  const res = await browserFetch("v1/crm/service-types", {
    method: "POST",
    body: JSON.stringify({
      code: t.code.trim(),
      label: t.label.trim(),
      active: t.active,
      sortOrder: t.sortOrder,
      ...(t.slaHours != null ? { slaHours: t.slaHours } : {}),
    }),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
}

export async function updateServiceType(id: string, t: ServiceType): Promise<void> {
  const res = await browserFetch(`v1/crm/service-types/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      label: t.label.trim(),
      active: t.active,
      sortOrder: t.sortOrder,
      // Send null to clear, a number to set; omit only when undefined.
      ...(t.slaHours !== undefined ? { slaHours: t.slaHours } : {}),
    }),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
}

export async function deleteServiceType(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/service-types/${id}`, { method: "DELETE" });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
}
