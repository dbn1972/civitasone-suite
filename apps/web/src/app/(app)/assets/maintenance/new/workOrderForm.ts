import { todayIST } from "@/lib/formatters";

export const MAINTENANCE_TYPES = ["preventive", "breakdown", "corrective", "amc"] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  preventive: "Preventive",
  breakdown: "Breakdown",
  corrective: "Corrective",
  amc: "AMC (annual maintenance contract)",
};

/**
 * GAP-ASSETS-MAINTENANCE-NEW-03 (policy value, configurable): types that record
 * work which has already happened or is already urgent (a breakdown being logged
 * after the fact), so a scheduled date in the past is legitimate. Every other
 * type is forward-looking scheduling and may not start in the past.
 */
export const PAST_DATE_ALLOWED_TYPES: ReadonlyArray<MaintenanceType> = ["breakdown", "corrective"];

export function parseMaintenanceType(value: string | null | undefined): MaintenanceType {
  return MAINTENANCE_TYPES.find((t) => t === value) ?? "breakdown";
}

/** Only a well-formed uuid from a deep link is trusted as a preselected asset. */
export function parseAssetIdParam(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

/** Returns an inline error message, or null when the date is acceptable. `today` is "YYYY-MM-DD" (IST by default). */
export function validateScheduledDate(
  type: MaintenanceType,
  date: string,
  today: string = todayIST(),
  pastAllowed: ReadonlyArray<MaintenanceType> = PAST_DATE_ALLOWED_TYPES,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Choose a valid date.";
  if (date < today && !pastAllowed.includes(type)) {
    return `A ${MAINTENANCE_TYPE_LABELS[type].toLowerCase()} job cannot be scheduled in the past. Pick today or a later date.`;
  }
  return null;
}

export function pageTitleFor(type: MaintenanceType): { title: string; subtitle: string; submit: string } {
  if (type === "preventive") {
    return { title: "Schedule Maintenance", subtitle: "Schedule preventive maintenance against an asset.", submit: "Schedule job" };
  }
  return { title: "Log Maintenance Job", subtitle: "Raise a work order against an asset.", submit: "Log job" };
}
