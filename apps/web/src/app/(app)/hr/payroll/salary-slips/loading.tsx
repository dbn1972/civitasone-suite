import { getTranslations } from "next-intl/server";
import { SkeletonTable } from "../../../../_components/ds";

// GAP-PAYROLL-SALARY-SLIPS-06: this was one of only 4 of 30 payroll
// loading.tsx files still on Tailwind slate-50/slate-200 + min-h-screen +
// max-w-7xl -- ignores dark mode (a hardcoded light grey flashes regardless
// of theme) and doesn't match the DS skeleton every sibling payroll list
// page already uses. SkeletonTable already models exactly this page's shape
// (4 stat cards + filter bar + table), so this needs no bespoke markup.
export default async function HRSalarySlipsLoading() {
  const t = await getTranslations("salarySlips");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("title")}</h1>
          <div className="sub">{t("subtitle")}</div>
        </div>
      </div>
      <SkeletonTable rows={8} />
    </div>
  );
}
