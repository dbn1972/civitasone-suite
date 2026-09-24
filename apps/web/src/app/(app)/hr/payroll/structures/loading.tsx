import { SkeletonTable } from "../../../../_components/ds";
import { PageHeader } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("payrollStructures");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <SkeletonTable rows={6} />
    </div>
  );
}
