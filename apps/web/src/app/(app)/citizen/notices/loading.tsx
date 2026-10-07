import { getTranslations } from "next-intl/server";
import { StatGrid, SkeletonCard, SkeletonBar, SkeletonTable } from "../../../_components/ds";

/**
 * GAP-CITIZEN-PORTAL-04: match the real notices page shape (PageHeader +
 * 4-card StatGrid + a DataTable) rather than a single bare `.skeleton` div,
 * so there is no layout jump when data arrives.
 */
export default async function Loading() {
  const t = await getTranslations("msg");
  return (
    <div className="page-main wrap" role="status" aria-label={t("loading")}>
      <div style={{ marginBottom: 16 }}>
        <SkeletonBar w="40%" h={24} />
        <div style={{ marginTop: 8 }}>
          <SkeletonBar w="60%" />
        </div>
      </div>
      <StatGrid>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </StatGrid>
      <div style={{ marginTop: 16 }}>
        <SkeletonTable rows={6} />
      </div>
    </div>
  );
}
