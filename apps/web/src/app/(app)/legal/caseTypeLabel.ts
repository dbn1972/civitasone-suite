import { humanizeStatus } from "@/lib/formatters";

/**
 * GAP-LEGAL-LIST-03: human label for a raw case-type code (the summary payload
 * carries a lowercase enum such as "writ"). Falls back to humanizeStatus for
 * anything without an explicit label.
 */
const CASE_TYPE_LABELS: Record<string, string> = {
  writ: "Writ Petition",
  civil: "Civil",
  criminal: "Criminal",
  arbitration: "Arbitration",
  tribunal: "Tribunal",
  appeal: "Appeal",
  other: "Other",
};
export function caseTypeLabel(type: string): string {
  return CASE_TYPE_LABELS[type.toLowerCase()] ?? humanizeStatus(type);
}
