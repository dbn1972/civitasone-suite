import { PageHeader, SkeletonTable } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

export default async function PayrollRunsLoading() {
  const t = await getTranslations("payrollRuns");
  const tCommon = await getTranslations("payrollCommon");
  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll"
        backLabel={tCommon("backToPayroll")}
      />
      {/* GAP-PAYROLL-RUNS-05: this used to draw 4 stat blocks and a filter
          bar the real page never rendered (it rendered only a bare table).
          Now that the page renders PayrollRunsTable (see RUNS-02), this
          mirrors /hr/payroll's own loading.tsx, which skeletons the same
          table component. */}
      <SkeletonTable rows={6} />
    </div>
  );
}
