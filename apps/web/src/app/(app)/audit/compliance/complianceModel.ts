import type { AuditComplianceItem } from "@civitasone/types";

/**
 * GAP-AUDIT-COMPLIANCE-04 — ONE status model for the compliance screen, shared
 * by the KPIs and the downloadable snapshot so the two can never disagree about
 * a denominator. The real status union (@civitasone/types AuditComplianceItem)
 * is complied | pending | overdue | na. "Open actions" are the items still
 * requiring work (pending + overdue). The compliance score is the share of
 * ACTIONABLE items that are complied, i.e. complied / (complied + pending +
 * overdue) — "na" (not applicable) is excluded from BOTH numerator and
 * denominator so a not-applicable control neither helps nor hurts the score,
 * keeping it consistent with Open Actions. `na` is surfaced separately so it is
 * visible, not silently folded into the score.
 */
export type ComplianceCounts = {
  total: number;
  complied: number;
  pending: number;
  overdue: number;
  na: number;
  openActions: number;
  /** actionable denominator = complied + pending + overdue */
  actionable: number;
  /** integer percent, or null when there is nothing actionable to score */
  scorePct: number | null;
};

export function complianceCounts(items: ReadonlyArray<AuditComplianceItem>): ComplianceCounts {
  const total = items.length;
  const complied = items.filter((i) => i.status === "complied").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const overdue = items.filter((i) => i.status === "overdue").length;
  const na = items.filter((i) => i.status === "na").length;
  const actionable = complied + pending + overdue;
  return {
    total,
    complied,
    pending,
    overdue,
    na,
    openActions: pending + overdue,
    actionable,
    scorePct: actionable > 0 ? Math.round((complied / actionable) * 100) : null,
  };
}

/**
 * GAP-AUDIT-COMPLIANCE-03 — deterministic partition. Each item lands in exactly
 * ONE bucket (first match wins, DPDP before regulatory), and anything that
 * matches neither goes to "other" — no half-slice fallback, so no item is ever
 * duplicated across cards or placed in a bucket it does not belong to.
 */
export type CompliancePartition = {
  dpdp: AuditComplianceItem[];
  regulatory: AuditComplianceItem[];
  other: AuditComplianceItem[];
};

const DPDP_TERMS = ["dpdp", "data"];
const REGULATORY_TERMS = ["cert", "iso", "ntp"];

export function partitionCompliance(items: ReadonlyArray<AuditComplianceItem>): CompliancePartition {
  const dpdp: AuditComplianceItem[] = [];
  const regulatory: AuditComplianceItem[] = [];
  const other: AuditComplianceItem[] = [];
  for (const item of items) {
    const law = (item.lawOrRule ?? "").toLowerCase();
    if (DPDP_TERMS.some((t) => law.includes(t))) {
      dpdp.push(item);
    } else if (REGULATORY_TERMS.some((t) => law.includes(t))) {
      regulatory.push(item);
    } else {
      other.push(item);
    }
  }
  return { dpdp, regulatory, other };
}
