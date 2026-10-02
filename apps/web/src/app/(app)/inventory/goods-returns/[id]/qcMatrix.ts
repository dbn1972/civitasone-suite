/**
 * QC verdict -> allowed dispositions for a goods return, and the one set of
 * disposition labels shared by the form, the detail page and the register
 * (GAP-INVENTORY-GOODS-RETURNS-DETAIL-01 / -02).
 *
 * The inventory-service qcInspectionBody refinement is deliberately looser
 * (it only rejects failed+restock and passed+scrap, and leaves "conditional"
 * open); this is the stricter matrix the form offers. Keep the two in step.
 */
export type QcVerdict = "passed" | "failed";
export type Disposition = "restock" | "quarantine" | "scrap";

/**
 * Labels say exactly what the backend stores. The backend enum has no
 * "return to vendor" or "accept with penalty" value, so the UI must not claim
 * one (a return-to-vendor recorded as "restock" would put rejected stock back
 * on hand).
 */
export const DISPOSITION_LABELS: Record<string, string> = {
  pending: "Pending",
  restock: "Restock to stock",
  quarantine: "Quarantine",
  scrap: "Scrap",
};

export function dispositionLabel(value: string): string {
  return DISPOSITION_LABELS[value] ?? value;
}

const ALLOWED: Record<QcVerdict, readonly Disposition[]> = {
  passed: ["restock"],
  failed: ["quarantine", "scrap"],
};

export function allowedDispositions(verdict: QcVerdict): readonly Disposition[] {
  return ALLOWED[verdict];
}

export function isDispositionAllowed(verdict: QcVerdict, disposition: string): disposition is Disposition {
  return (ALLOWED[verdict] as readonly string[]).includes(disposition);
}

/** Inspector notes are mandatory for a failed verdict or a scrap, so the write-off is explained. */
export const QC_NOTES_MIN_LENGTH = 10;
export const QC_NOTES_MAX_LENGTH = 512;

export function notesRequired(verdict: QcVerdict | "", disposition: string): boolean {
  return verdict === "failed" || disposition === "scrap";
}
