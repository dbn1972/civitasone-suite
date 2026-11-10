import { PageHeader, SkeletonTable } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

export default async function HRLeaveTypesLoading() {
  const t = await getTranslations("leaveTypes");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <SkeletonTable rows={6} />
    </div>
  );
}
