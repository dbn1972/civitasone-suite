import type { useTranslations } from "next-intl";

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

const SALARY_SLIP_STATUSES = ["draft", "finalized", "paid", "computed"] as const;

/** SalarySlipSummary.status (packages/types). */
export function salarySlipStatusLabel(status: string, t: TFn): string {
  return (SALARY_SLIP_STATUSES as readonly string[]).includes(status)
    ? t(`status.${status}` as Parameters<TFn>[0])
    : status;
}
