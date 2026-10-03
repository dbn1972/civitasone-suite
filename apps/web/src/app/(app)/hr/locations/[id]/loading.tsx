import { PageHeader, Card } from "../../../../_components/ds";
import { SkeletonTable } from "../../../../_components/ds/Skeleton";
import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("locationDetail");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("fallbackTitle")} back="/hr/locations" backLabel={t("backLabel")} help="hr" />
      <Card title={t("employeesTitle")}>
        <SkeletonTable rows={8} />
      </Card>
    </div>
  );
}
