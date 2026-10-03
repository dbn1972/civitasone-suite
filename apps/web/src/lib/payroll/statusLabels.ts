import type { useTranslations } from "next-intl";
import type { PillVariant } from "@/app/_components/ds/StatusPill";

type TFn = ReturnType<typeof useTranslations>;

/**
 * Hindi-locale finding: table STATUS values didn't translate even though the
 * page chrome did -- callers passed the raw backend enum straight to
 * StatusPill, which has no i18n of its own (it only maps the raw string to a
 * pill COLOR; label defaults to a humanized-but-still-English string). These
 * two helpers translate the label explicitly, per table, without touching
 * StatusPill/DataTable's shared, generic status-cell rendering (used by
 * ~80+ call sites across the app, not just payroll) -- callers pass a
 * `render` column instead of `cellType: "status"` and supply the translated
 * `label` themselves; `status` (untranslated) still drives the pill color.
 *
 * Each accepts the raw status and the CALLER's own namespaced translator
 * (`useTranslations("payrollRunsTable")` / `useTranslations("salarySlipsTable")`)
 * and reads a nested `status.<value>` key already added to that same
 * namespace in en.json/hi.json -- kept in the table's own namespace (not a
 * new shared one) so the existing en/hi key-parity coverage test for this
 * slice (scripts/i18n-extract/hr-payroll-remaining-i18n-coverage.test.mjs)
 * already asserts both locales stay in lockstep for these new keys, the
 * same way it already does for every other key in these namespaces.
 *
 * Falls back to the raw status string for any value outside the known set,
 * so a future/unexpected backend status never renders blank or throws on a
 * missing message key -- the same "never worse than before" fallback
 * philosophy StatusPill's own humanizeStatus default already uses.
 */

const PAYROLL_RUN_STATUSES = ["draft", "processing", "completed", "paid", "disbursed", "failed"] as const;

/** PayrollRunDetail.status (packages/types) -- "failed" is the real status PR #1566 added. */
export function payrollRunStatusLabel(status: string, t: TFn): string {
  return (PAYROLL_RUN_STATUSES as readonly string[]).includes(status)
    ? t(`status.${status}` as Parameters<TFn>[0])
    : status;
}

/**
 * GAP-PAYROLL-HOME-07: pill tone for a payroll RUN status. StatusPill's global
 * map (shared by ~80 call sites) paints "completed" and "paid" the same green,
 * so a run that is computed but not yet paid looked identical to one whose
 * money has moved. Payroll-local override, passed as StatusPill's `variant`
 * (the global map is deliberately left alone):
 *   draft -> neutral, processing -> warn, completed -> info (computed, awaiting
 *   disbursement: NOT green), paid/disbursed -> good, failed -> bad.
 * The translated label already differs in text ("Completed" vs "Paid"), so the
 * distinction is not colour-only. An unknown status gets no override (undefined)
 * and falls back to StatusPill's own default.
 */
const PAYROLL_RUN_VARIANT: Record<(typeof PAYROLL_RUN_STATUSES)[number], PillVariant> = {
  draft: "mut",
  processing: "warn",
  completed: "info",
  paid: "good",
  disbursed: "good",
  failed: "bad",
};

export function payrollRunStatusVariant(status: string): PillVariant | undefined {
  return (PAYROLL_RUN_STATUSES as readonly string[]).includes(status)
    ? PAYROLL_RUN_VARIANT[status as (typeof PAYROLL_RUN_STATUSES)[number]]
    : undefined;
}

// draft/finalized come from the list endpoint's narrowed status; computed,
// approved, paid, held and exception are the raw payroll_slips.status values
// (payroll_slips_status_check) that GET /v1/payroll/slips/:id returns.
const SALARY_SLIP_STATUSES = ["draft", "finalized", "computed", "approved", "paid", "held", "exception"] as const;

/** SalarySlipSummary / SalarySlipDetail status (packages/schemas web.ts). */
export function salarySlipStatusLabel(status: string, t: TFn): string {
  return (SALARY_SLIP_STATUSES as readonly string[]).includes(status)
    ? t(`status.${status}` as Parameters<TFn>[0])
    : status;
}

/**
 * GAP-PAYROLL-SALARY-SLIPS-05 / GAP-PAYROLL-SLIPS-DETAIL-05: a draft or
 * computed slip has not been through finalisation and may still change --
 * printing or downloading it before then can circulate figures that get
 * revised later. One place for "which statuses count as final", shared by
 * SalarySlipsTable.tsx (list print link), salary-slips/[id]/page.tsx
 * (PrintButton) and slips/[id]/page.tsx (Download PDF / printable-slip
 * link) so the rule can't quietly diverge between the three surfaces that
 * each gate a control on this one backend slip.
 */
export function isPrintableSlipStatus(status: string): boolean {
  return status === "finalized" || status === "paid";
}

/**
 * GAP-PAYROLL-INCOME-TAX-04: /v1/payroll/income-tax's row status (payroll-
 * service's tax/routes.ts) only ever actually produces "submitted" (a
 * declaration on file -- tax/consumer.ts's submitDeclaration always writes
 * status:"submitted", on both insert and update) or the route's own literal
 * "pending" default when no declaration exists for that employee+FY at all
 * (tax/routes.ts: `status: dec?.status ?? "pending"`) -- traced from the
 * actual backend source, not assumed. "draft"/"finalized"/"completed" are
 * tolerated here defensively (the DB column's own schema default is "draft",
 * and a future review/approval stage may one day add "finalized"/
 * "completed") but are not currently reachable from any code path.
 */
const INCOME_TAX_STATUSES = ["submitted", "pending", "draft", "finalized", "completed"] as const;

/** Income-tax declaration row status (payroll-service tax/routes.ts). */
export function incomeTaxStatusLabel(status: string, t: TFn): string {
  return (INCOME_TAX_STATUSES as readonly string[]).includes(status)
    ? t(`status.${status}` as Parameters<TFn>[0])
    : status;
}
