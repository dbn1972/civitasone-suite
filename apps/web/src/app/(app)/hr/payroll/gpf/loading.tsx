import { getTranslations } from "next-intl/server";
import { PageHeader, SkeletonCard, SkeletonTable } from "../../../../_components/ds";

// GAP-PAYROLL-GPF-07: was Tailwind slate/min-h-screen markup outside the
// design system. Now the same ds PageHeader + skeleton shapes as
// payroll/loading.tsx, titled like the loaded page so the heading does not
// change when data arrives.
export default async function Loading() {
  const t = await getTranslations("gpfStatements");
  return (
    <>
      <PageHeader title={t("loadingHeading")} subtitle={t("subtitle")} />
      <div className="page-main wrap" aria-busy="true" aria-label={t("loadingHeading")}>
        <SkeletonCard />
        <SkeletonTable rows={6} />
      </div>
    </>
  );
}
