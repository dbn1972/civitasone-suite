/**
 * UAT T-EDGE TE-03 (L06): a leave allocation covers one leave year, named by its label in
 * hrms_leave_allocs.fy -- "YYYY-YY" for a financial year (1 Apr - 31 Mar) or "YYYY-CY" for
 * a calendar year (the CCS leave-year label used by the leave year-end job). A request
 * that runs past either end (31 Mar - 1 Apr on a 2026-27 allocation) used to be debited in
 * full from that one year. It is now refused with the boundary, so the applicant applies
 * the two parts separately, each against its own year.
 */
export type AllocationPeriod = { start: string; end: string; label: string };

/** The dates an allocation label covers, or null for a label this check does not know. */
export function allocationPeriod(label: string | null | undefined): AllocationPeriod | null {
  const t = (label ?? "").trim();
  const cy = /^(\d{4})-CY$/.exec(t);
  if (cy) return { start: `${cy[1]}-01-01`, end: `${cy[1]}-12-31`, label: t };
  const fy = /^(\d{4})-(\d{2})$/.exec(t);
  if (fy && Number(fy[2]) === (Number(fy[1]) + 1) % 100) {
    return { start: `${fy[1]}-04-01`, end: `${Number(fy[1]) + 1}-03-31`, label: t };
  }
  return null;
}

/** Null when [fromDate, toDate] sits inside the allocation period, otherwise the refusal text. */
export function allocationPeriodRefusal(label: string | null | undefined, fromDate: string, toDate: string): string | null {
  const p = allocationPeriod(label);
  if (!p || (fromDate >= p.start && toDate <= p.end)) return null;
  const parts: string[] = [];
  if (fromDate < p.start) parts.push(`the days before ${p.start}`);
  if (toDate > p.end) parts.push(`the days after ${p.end}`);
  return `leave ${fromDate}..${toDate} does not fall inside the ${p.label} allocation (${p.start}..${p.end}); `
    + `apply for ${parts.join(" and ")} separately, against the allocation of that leave year`;
}
