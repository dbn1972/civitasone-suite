// Client-safe module (no server imports): used by "use client" components, so it must
// not import _data.ts (which pulls apiClient -> next/headers).
import type { MetricUnit } from "./_data";

export type AnalyticsCatalogLabels = {
  metrics: Record<string, { label: string; unit: MetricUnit }>;
  dimensions: Record<string, string>;
};

/** "department_id" -> "Department"; "event_type" -> "Event type". Fallback only. */
export function humanizeKey(key: string): string {
  const words = key.replace(/_id$/i, "").split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return key;
  const joined = words.join(" ").toLowerCase();
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}
