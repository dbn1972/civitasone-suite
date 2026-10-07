/**
 * GAP-HELPDESK-CATALOGUE-MY-REQUESTS-03 / BREACHES-05: one place that maps a
 * raw helpdesk SLA status (within_sla / due_soon / at_risk / breached, in any
 * separator casing) to a correctly-cased display label — so "SLA" stays an
 * uppercase acronym everywhere and a bare `.replace(/_/g, " ")` never surfaces
 * "within sla" / "Within Sla" to a user. Extracted from the helpdesk SlaBadge
 * so the badge and the catalogue tables agree on the vocabulary.
 */

/** Canonical SLA display labels, keyed on the snake_case backend values. */
export const SLA_LABELS: Record<string, string> = {
  within_sla: "Within SLA",
  due_soon: "Due soon",
  at_risk: "At risk",
  breached: "Breached",
};

/**
 * Human SLA label for a raw status, tolerant of separator/casing differences
 * ("within-sla", "WITHIN_SLA", "within sla" all normalise the same). Falls back
 * to a title-cased version of the raw value (never a lowercased acronym), and to
 * "Unknown" when the value is missing.
 */
export function slaLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  const key = status.toLowerCase().replace(/[\s-]+/g, "_");
  if (SLA_LABELS[key]) return SLA_LABELS[key];
  // Unknown value: title-case words but keep a 3-letter "sla" as "SLA".
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => (w === "sla" ? "SLA" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
