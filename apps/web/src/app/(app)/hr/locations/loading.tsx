import { PageHeader, Card } from "../../../_components/ds";
import { SkeletonTable } from "../../../_components/ds/Skeleton";
import { getTranslations } from "next-intl/server";

// GAP-HR-LOCATIONS-07: this used to be a bare `<div className="skeleton">`
// with no header or table shape, and no `page-main wrap` wrapper -- so
// padding/width differed from the loaded page and the layout shifted once
// data arrived. Now matches page.tsx's own chrome (PageHeader + Card +
// SkeletonTable, the latter already rendering a 4-card stat row, a filter
// bar, a header row, and 8 body rows) so there's no jump.
export default async function Loading() {
  const t = await getTranslations("locations");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={t("backLabel")} help="hr" />
      <Card title={t("title")}>
        <SkeletonTable rows={8} />
      </Card>
    </div>
  );
}
