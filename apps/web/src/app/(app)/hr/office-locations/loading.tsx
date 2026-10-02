import { PageHeader, Card } from "../../../_components/ds";
import { SkeletonTable } from "../../../_components/ds/Skeleton";
import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("officeLocations");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <Card title={t("listTitle")}>
        <SkeletonTable rows={6} />
      </Card>
    </div>
  );
}
