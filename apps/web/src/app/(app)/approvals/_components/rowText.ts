import { formatIndianDate, formatMoney, formatPayPeriod } from "@/lib/formatters";
import { asGiven, presentable, type InboxRow, type RefSummary, type SlaState } from "../_lib/inboxModel";

/** next-intl translator for the approvalsInbox namespace (kept loose so tests can pass a stub). */
export type T = (key: string, values?: Record<string, string | number>) => string;

/** "Approve purchase order PO/2026/0033", never "Review". */
export function taskTitle(t: T, row: InboxRow): string {
  const f = new Map((row.summary?.fields ?? []).map((x) => [x.key, x.value]));
  if (row.type === "leave") {
    const leaveType = asGiven(f.get("leaveType"));
    const days = Number(f.get("days"));
    if (leaveType && Number.isFinite(days) && days > 0) {
      // W9: the dates make two leave rows from the same person tell apart.
      const from = asGiven(f.get("fromDate"));
      const to = asGiven(f.get("toDate"));
      if (from && to && formatIndianDate(from) !== "\u2014" && formatIndianDate(to) !== "\u2014") {
        return t("taskTitleLeaveDates", { leaveType, days, from: formatIndianDate(from), to: formatIndianDate(to) });
      }
      return t("taskTitleLeave", { leaveType, days });
    }
  }
  if (row.type === "payrollRun" && !row.reference) {
    const period = asGiven(f.get("payPeriod"));
    if (period) return t("taskTitle.payrollRun", { ref: formatPayPeriod(period) });
  }
  if (row.reference) return t(`taskTitle.${row.type}`, { ref: row.reference });
  if (row.type === "other") {
    const name = presentable(row.summary?.instanceName ?? row.task.instanceName);
    if (name) return t("taskTitleNamed", { name });
  }
  return t(`taskTitleNoRef.${row.type}`);
}

/** "Level 2 of 3: Deputy Secretary Approval". */
export function stageText(t: T, s: RefSummary["stage"] | null | undefined): string | null {
  if (!s) return null;
  const step = presentable(s.step);
  if (s.of && step) return t("stage", { level: s.level, of: s.of, step });
  if (s.of) return t("stageNoStep", { level: s.level, of: s.of });
  if (step) return t("stageNoTotal", { level: s.level, step });
  return t("stageLevelOnly", { level: s.level });
}

export function slaText(t: T, sla: { state: SlaState; days: number }, dueAt: string | null | undefined): string {
  switch (sla.state) {
    case "overdue": return t("sla.overdue", { days: sla.days });
    case "dueToday": return t("sla.dueToday");
    case "dueSoon": return t("sla.dueSoon", { days: sla.days });
    case "onTrack":
    case "farDate": return t("sla.onTrack", { date: formatIndianDate(dueAt ?? null) });
    default: return t("sla.none");
  }
}

/** Pill tone for an SLA state; the text always says the same thing (never colour alone). */
export function slaTone(state: SlaState): "bad" | "warn" | "info" | "mut" {
  return state === "overdue" ? "bad" : state === "dueToday" || state === "dueSoon" ? "warn" : state === "onTrack" ? "info" : "mut";
}

/** Indian grouping, two decimals (Rs 1,23,456.00); a delta keeps its sign. */
export function amountText(t: T, amountMinor: string | null): string {
  if (amountMinor === null) return t("noAmount");
  const s = formatMoney(amountMinor);
  return s === "—" ? t("noAmount") : s;
}

export function ageText(t: T, age: number | null): string | null {
  if (age === null) return null;
  return age === 0 ? t("age.today") : t("age.days", { days: age });
}
