import { getTranslations } from "next-intl/server";
import { PageHeader, SkeletonTable } from "../../../../_components/ds";

export default async function Loading() {
  const t = await getTranslations("payrollDaRates");
  return (
    <div className="page-main wrap" aria-busy="true" aria-label={t("loadingAriaLabel")}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={t("backLabel")} />
      <SkeletonTable rows={6} />
    </div>
  );
}
