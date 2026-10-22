import { SkeletonTable, PageHeader } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("payrollPayGroups");
  const tCommon = await getTranslations("payrollCommon");
  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={tCommon("backToPayroll")}
      />
      <SkeletonTable rows={4} />
    </div>
  );
}
