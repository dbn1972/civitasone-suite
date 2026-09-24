import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

export default async function PayrollLoading() {
  const t = await getTranslations("payroll");
  return (
    <>
      <PageHeader
        title={t("runsCardTitle")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel="HR"
      />
      <div className="page-main wrap">
        <SkeletonTable rows={6} />
      </div>
    </>
  );
}
