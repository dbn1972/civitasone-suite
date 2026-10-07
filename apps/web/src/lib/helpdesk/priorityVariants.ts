/**
 * Helpdesk priority -> pill tone. Kept module-local (passed via DataTable
 * `statusVariants` / StatusPill `variant`) because low/medium/high mean
 * different things in other registers and must not enter the shared
 * STATUS_MAP.
 */
export type PriorityTone = "good" | "warn" | "mut" | "bad" | "info";

const BASE: Record<string, PriorityTone> = { low: "info", medium: "warn", high: "warn", critical: "bad", urgent: "bad" };

/** Keyed by raw value in lower, Title and UPPER case, as the APIs return any of them. */
export const HELPDESK_PRIORITY_VARIANTS: Record<string, PriorityTone> = Object.fromEntries(
  Object.entries(BASE).flatMap(([k, v]) => [[k, v], [k.charAt(0).toUpperCase() + k.slice(1), v], [k.toUpperCase(), v]]),
);

export function helpdeskPriorityVariant(p: string | null | undefined): PriorityTone | undefined {
  return p ? BASE[p.toLowerCase()] : undefined;
}
